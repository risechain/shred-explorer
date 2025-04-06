use std::sync::Arc;
use anyhow::Result;
use futures::future::join_all;
use tracing::{debug, error, info, warn};
use ethers::providers::{Provider, Http, Middleware};
use ethers::types::BlockNumber;
use tokio::time::{sleep, Duration};

use crate::db::Database;
use crate::models::{Block, Transaction, BlockQueue, BlockProcessor};
use crate::utils::retry::with_retry;
use crate::sync::{SyncError, SharedSyncState};

/// Component responsible for historical sync
pub struct HistoricSync {
    provider: Provider<Http>,
    db: Arc<Database>,
    sync_state: SharedSyncState,
    batch_size: usize,
    max_concurrent_requests: usize,
    retry_delay: u64,
    max_retries: u32,
    rpc_batch_size: usize,
    block_queue: Arc<BlockQueue>,
    block_processor: Arc<BlockProcessor>,
}

impl HistoricSync {
    pub fn new(
        provider_url: String,
        db: Arc<Database>,
        sync_state: SharedSyncState,
        batch_size: usize,
        max_concurrent_requests: usize,
        block_queue_size: usize,
    ) -> Result<Self, SyncError> {
        // Create an HTTP provider with ethers
        let provider = Provider::<Http>::try_from(provider_url)
            .map_err(|e| SyncError::Provider(format!("Failed to create provider: {}", e)))?;
            
        // Create the block queue
        let block_queue = Arc::new(BlockQueue::with_capacity(block_queue_size));
        info!("Created block queue with capacity {}", block_queue_size);
        
        // Create block processor
        let block_processor = Arc::new(BlockProcessor::new(block_queue.clone_queue()));
        info!("Created block processor");
            
        Ok(Self {
            provider,
            db: db.clone(),
            sync_state,
            batch_size,
            max_concurrent_requests,
            retry_delay: 1000, // Default 1 second
            max_retries: 5,    // Default 5 retries
            rpc_batch_size: 10, // Default 10 blocks per RPC batch
            block_queue,
            block_processor,
        })
    }
    
    /// Configure retry settings
    pub fn with_retry_settings(mut self, retry_delay: u64, max_retries: u32) -> Self {
        info!("Setting retry settings: delay={}ms, max_retries={}", retry_delay, max_retries);
        self.retry_delay = retry_delay;
        self.max_retries = max_retries;
        self
    }
    
    /// Configure RPC batch size
    pub fn with_rpc_batch_size(mut self, rpc_batch_size: usize) -> Self {
        info!("Setting RPC batch size to {}", rpc_batch_size);
        self.rpc_batch_size = rpc_batch_size;
        self
    }
    
    /// Start the block processor
    pub async fn start_processor(&self, workers: usize) {
        info!("Starting block processor with {} workers", workers);
        
        // Start the block processor with the specified number of workers
        for i in 0..workers {
            info!("Starting database worker {}", i + 1);
            let processor = Arc::clone(&self.block_processor);
            let db = Arc::clone(&self.db);
            processor.start(db).await;
        }
    }
    
    /// Start the historical sync process
    pub async fn start(&self) -> Result<(), SyncError> {
        info!("Starting historical sync");
        
        // Get latest block from the chain
        let latest_block_number = self.get_latest_block_number().await?;
        info!("Latest block on chain: {}", latest_block_number);
        
        // Get the block to start syncing from
        let start_block = {
            let state = self.sync_state.lock().await;
            state.latest_synced_block
        };
        
        info!("Starting historical sync from block {} to {}", start_block, latest_block_number);
        
        // If we're already at the latest block, mark as complete
        if start_block >= latest_block_number {
            info!("Already at latest block, marking historic sync as complete");
            let mut state = self.sync_state.lock().await;
            state.historic_sync_complete = true;
            return Ok(());
        }
        
        // Process blocks in batches
        self.process_blocks(start_block, latest_block_number).await?;
        
        // Wait for the queue to be fully processed
        self.wait_for_queue_to_empty().await?;
        
        // Mark historical sync as complete
        {
            let mut state = self.sync_state.lock().await;
            state.historic_sync_complete = true;
            state.latest_synced_block = latest_block_number;
        }
        
        info!("Historical sync completed successfully up to block {}", latest_block_number);
        Ok(())
    }
    
    /// Wait for the block queue to be fully processed
    async fn wait_for_queue_to_empty(&self) -> Result<(), SyncError> {
        info!("Waiting for block queue to be fully processed...");
        
        let max_wait_time = Duration::from_secs(600); // 10 minutes max wait time
        let start_time = tokio::time::Instant::now();
        
        while !self.block_queue.is_empty() {
            if start_time.elapsed() > max_wait_time {
                warn!("Timed out waiting for block queue to empty");
                return Err(SyncError::Other("Timed out waiting for block queue to empty".to_string()));
            }
            
            info!(
                "Waiting for queue to empty: {} blocks remaining", 
                self.block_queue.len()
            );
            
            sleep(Duration::from_secs(5)).await;
        }
        
        info!("Block queue fully processed");
        Ok(())
    }
    
    /// Get the latest block number from the chain
    async fn get_latest_block_number(&self) -> Result<u64, SyncError> {
        debug!("Fetching latest block number from the chain");
        
        let block_number = with_retry(
            || async {
                // Use ethers provider to get the latest block number
                let number = self.provider.get_block_number().await
                    .map_err(|e| SyncError::Provider(format!("Failed to get block number: {}", e)))?;
                Ok::<_, SyncError>(number.as_u64())
            },
            self.retry_delay,
            self.max_retries,
            "get_latest_block_number",
        ).await?;
        
        debug!("Latest block number: {}", block_number);
        Ok(block_number)
    }
    
    /// Process blocks from start to end
    async fn process_blocks(&self, start_block: u64, end_block: u64) -> Result<(), SyncError> {
        let total_blocks = end_block.saturating_sub(start_block) + 1;
        info!(
            "Processing {} blocks from {} to {} with RPC batch size {}",
            total_blocks, start_block, end_block, self.rpc_batch_size
        );
        
        let mut current_block = start_block;
        let mut processed_blocks = 0;
        
        while current_block <= end_block {
            let batch_end = std::cmp::min(current_block + self.batch_size as u64 - 1, end_block);
            let batch_size = (batch_end - current_block + 1) as usize;
            
            info!(
                "Processing batch of {} blocks from {} to {} ({}/{})",
                batch_size, 
                current_block, 
                batch_end,
                processed_blocks,
                total_blocks
            );
            
            let chunk_size = batch_size;
            let chunks = (batch_size + chunk_size - 1) / chunk_size; // Ceiling division
            
            for i in 0..chunks {
                let start = current_block + (i * chunk_size) as u64;
                let end = std::cmp::min(start + chunk_size as u64 - 1, batch_end);
                
                debug!("Processing chunk of blocks from {} to {}", start, end);
                
                // Process blocks in this chunk using batch RPC requests
                self.process_block_chunk(start, end).await?;
                
                // Update processed count
                processed_blocks += (end - start + 1) as usize;
            }
            
            // Throttle if the queue is getting full
            self.throttle_if_queue_full().await;
            
            // Update the sync state
            {
                let mut state = self.sync_state.lock().await;
                state.latest_synced_block = batch_end;
            }
            
            current_block = batch_end + 1;
            
            info!(
                "Batch complete: {}/{} blocks processed ({:.2}%)", 
                processed_blocks, 
                total_blocks,
                (processed_blocks as f64 / total_blocks as f64) * 100.0
            );
        }
        
        info!("All blocks processed successfully");
        Ok(())
    }
    
    /// Throttle the processing if the queue is getting full
    async fn throttle_if_queue_full(&self) {
        // Calculate queue fullness as a percentage
        let capacity = self.block_queue.capacity();
        let queue_size = self.block_queue.len();
        
        // Get the fill percentage
        let fill_percentage = (queue_size as f64 / capacity as f64) * 100.0;
        
        // Throttle according to the fill level
        if fill_percentage > 90.0 {
            // Over 90% full - wait for a while
            warn!("Queue is over 90% full ({}/{}), throttling heavily", queue_size, capacity);
            sleep(Duration::from_millis(5000)).await;
        } else if fill_percentage > 75.0 {
            // Over 75% full - wait a bit
            warn!("Queue is over 75% full ({}/{}), throttling moderately", queue_size, capacity);
            sleep(Duration::from_millis(1000)).await;
        } else if fill_percentage > 50.0 {
            // Over 50% full - short wait
            debug!("Queue is over 50% full ({}/{}), throttling slightly", queue_size, capacity);
            sleep(Duration::from_millis(500)).await;
        }
        // Otherwise, continue at full speed
    }
    
    /// Process a chunk of blocks using batched RPC requests
    async fn process_block_chunk(&self, start_block: u64, end_block: u64) -> Result<(), SyncError> {
        let total_blocks = end_block - start_block + 1;
        let mut current_block = start_block;
        
        while current_block <= end_block {
            let batch_end = std::cmp::min(current_block + self.rpc_batch_size as u64 - 1, end_block);
            let blocks_in_batch = (batch_end - current_block + 1) as usize;
            
            info!(
                "Using RPC batch size of {} to fetch blocks {} to {}",
                self.rpc_batch_size, current_block, batch_end
            );
            
            // Create a batch of requests
            let blocks = self.fetch_blocks_batch(current_block..=batch_end).await?;
            info!("Fetched {} blocks from {} to {}", blocks.len(), current_block, batch_end);
            
            // Queue blocks for processing instead of saving directly
            for block in blocks {
                match self.convert_block(block) {
                    Ok(model_block) => {
                        // Push to the queue with throttling if full
                        let mut retry_count = 0;
                        let max_push_retries = 5;
                        
                        loop {
                            let push_result = self.block_queue.try_push(model_block.clone());
                            
                            if push_result {
                                // Successfully pushed
                                break;
                            } else {
                                // Queue is full
                                retry_count += 1;
                                
                                if retry_count >= max_push_retries {
                                    // Too many retries, use blocking push
                                    warn!("Queue still full after {} retries, using blocking push", max_push_retries);
                                    let block_number = model_block.number;
                                    if let Err(e) = self.block_queue.push(model_block).await {
                                        error!("Failed to push block {} to queue: {}", block_number, e);
                                    }
                                    break;
                                }
                                
                                // Wait before retrying
                                warn!("Queue full, waiting before retry {}/{}", retry_count, max_push_retries);
                                sleep(Duration::from_millis(500 * retry_count as u64)).await;
                            }
                        }
                    },
                    Err(e) => {
                        error!("Failed to convert block: {}", e);
                    }
                }
            }
            
            current_block = batch_end + 1;
        }
        
        Ok(())
    }
    
    /// Fetch a batch of blocks using ethers batch request capability
    async fn fetch_blocks_batch(&self, block_range: impl Iterator<Item = u64> + Clone) -> Result<Vec<ethers::types::Block<ethers::types::H256>>, SyncError> {
        debug!("Creating batch request for multiple blocks");
        
        let provider = self.provider.clone();
        let retry_delay = self.retry_delay;
        let max_retries = self.max_retries;
        
        // Collect block numbers into a vector to avoid lifetime issues
        let block_numbers: Vec<u64> = block_range.collect();
        
        // Use with_retry to handle any connection issues
        with_retry(
            move || {
                let provider = provider.clone();
                let block_numbers = block_numbers.clone();
                
                async move {
                    // Create a batch request
                    let mut batch = Vec::new();
                    
                    // Add block requests to the batch - only fetch transaction hashes, not full transaction data
                    for block_num in block_numbers {
                        batch.push(provider.get_block(BlockNumber::Number(block_num.into())));
                    }
                    
                    // Execute the batch request
                    let results = futures::future::try_join_all(batch).await
                        .map_err(|e| SyncError::Provider(format!("Failed to execute batch request: {}", e)))?;
                    
                    // Process results
                    let blocks = results.into_iter()
                        .enumerate()
                        .map(|(i, block_opt)| {
                            block_opt.ok_or_else(|| SyncError::BlockNotFound(i as u64))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    
                    Ok::<_, SyncError>(blocks)
                }
            },
            retry_delay,
            max_retries,
            "fetch_blocks_batch",
        ).await
    }
    
    /// Convert ethers block to our model
    fn convert_block(&self, eth_block: ethers::types::Block<ethers::types::H256>) -> Result<Block, SyncError> {
        let block_number = eth_block.number
            .ok_or_else(|| SyncError::Parse("Block number missing".to_string()))?
            .as_u64();
        
        debug!("Converting block {} to model", block_number);
        
        // Convert transaction hashes to our transaction model
        let transactions = eth_block.transactions.into_iter()
            .enumerate()
            .map(|(i, tx_hash)| {
                Transaction {
                    hash: format!("{:?}", tx_hash), // Convert H256 to string
                    from: None,    // We don't have this info without fetching full transactions
                    to: None,      // We don't have this info without fetching full transactions
                    value: "0".to_string(), // Default value
                    gas: 0,        // We don't have this info without fetching full transactions
                    gas_price: None, // We don't have this info without fetching full transactions
                    input: "0x".to_string(), // We don't have this info without fetching full transactions
                    nonce: 0,      // We don't have this info without fetching full transactions
                    transaction_index: i as u64,
                    block_hash: format!("{:?}", eth_block.hash.unwrap_or_default()),
                    block_number,
                }
            })
            .collect();
        
        // Create the block model
        Ok(Block {
            number: block_number,
            hash: format!("{:?}", eth_block.hash.unwrap_or_default()),
            parent_hash: format!("{:?}", eth_block.parent_hash),
            timestamp: eth_block.timestamp.as_u64(),
            transactions_root: format!("{:?}", eth_block.transactions_root),
            state_root: format!("{:?}", eth_block.state_root),
            receipts_root: format!("{:?}", eth_block.receipts_root),
            gas_used: eth_block.gas_used.as_u64(),
            gas_limit: eth_block.gas_limit.as_u64(),
            base_fee_per_gas: eth_block.base_fee_per_gas.map(|fee| fee.as_u64()),
            extra_data: format!("0x{}", hex::encode(eth_block.extra_data.to_vec())),
            miner: format!("{:?}", eth_block.author.unwrap_or_default()),
            difficulty: eth_block.difficulty,
            total_difficulty: eth_block.total_difficulty,
            size: eth_block.size.unwrap_or_default().as_u64(),
            transactions,
        })
    }
}