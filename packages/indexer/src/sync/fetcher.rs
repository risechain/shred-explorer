use std::sync::Arc;
use tracing::{debug, error, info, warn};
use ethers::providers::{Provider, Ws, Middleware};
use ethers::types::BlockNumber;
use tokio::time::{sleep, Duration};

use crate::models::{Block, BlockQueue, Transaction};
use crate::utils::retry::with_retry;
use crate::sync::SyncError;

/// Maximum number of concurrent batch fetches
const DEFAULT_MAX_CONCURRENT_BATCHES: usize = 5;


/// Block fetcher for concurrent block retrieval
pub struct BlockFetcher {
    /// Provider for network access using WebSockets
    provider: Provider<Ws>,
    /// Block queue for passing blocks to database workers
    block_queue: Arc<BlockQueue>,
    /// The RPC batch size to use when fetching blocks
    rpc_batch_size: usize,
    /// The maximum number of concurrent batch fetches
    max_concurrent_batches: usize,
    /// Retry delay for failed requests (ms)
    retry_delay: u64,
    /// Maximum number of retries for failed requests
    max_retries: u32,
    /// Worker stagger delay (ms per worker)
    worker_stagger_delay: u64,
}

impl BlockFetcher {
    #[allow(dead_code)]
    pub fn new(
        provider: Provider<Ws>, 
        block_queue: Arc<BlockQueue>,
        rpc_batch_size: usize,
        retry_delay: u64,
        max_retries: u32,
    ) -> Self {
        Self {
            provider,
            block_queue,
            rpc_batch_size,
            max_concurrent_batches: DEFAULT_MAX_CONCURRENT_BATCHES,
            retry_delay,
            max_retries,
            worker_stagger_delay: 100, // Default to 100ms per worker
        }
    }
    
    /// Create a new fetcher from a WebSocket URL
    pub async fn from_ws_url(
        ws_url: &str,
        block_queue: Arc<BlockQueue>,
        rpc_batch_size: usize,
        retry_delay: u64,
        max_retries: u32,
    ) -> Result<Self, SyncError> {
        info!("Creating WebSocket provider from URL: {}", ws_url);
        
        // Connect to the WebSocket provider
        let ws = Ws::connect(ws_url)
            .await
            .map_err(|e| SyncError::Provider(format!("Failed to connect to WebSocket: {}", e)))?;
            
        let provider = Provider::new(ws);
        info!("Successfully connected to WebSocket provider");
        
        Ok(Self {
            provider,
            block_queue,
            rpc_batch_size,
            max_concurrent_batches: DEFAULT_MAX_CONCURRENT_BATCHES,
            retry_delay,
            max_retries,
            worker_stagger_delay: 100, // Default to 100ms per worker
        })
    }

    /// Set the maximum number of concurrent batch fetches
    pub fn with_max_concurrent_batches(mut self, max_concurrent_batches: usize) -> Self {
        info!("Setting max concurrent batches to {}", max_concurrent_batches);
        self.max_concurrent_batches = max_concurrent_batches;
        self
    }
    
    /// Set the worker stagger delay in milliseconds
    pub fn with_worker_stagger_delay(mut self, delay_ms: u64) -> Self {
        info!("Setting worker stagger delay to {}ms per worker", delay_ms);
        self.worker_stagger_delay = delay_ms;
        self
    }

    /// Fetch a range of blocks concurrently using a continuous work-stealing approach
    pub async fn fetch_blocks_range(&self, start_block: u64, end_block: u64) -> Result<(), SyncError> {
        let total_blocks = end_block.saturating_sub(start_block) + 1;
        
        info!(
            "Fetching {} blocks from {} to {} with RPC batch size {} and max {} concurrent batches",
            total_blocks, start_block, end_block, self.rpc_batch_size, self.max_concurrent_batches
        );

        // Create a work queue of batches to process
        let work_queue = Arc::new(tokio::sync::Mutex::new(
            self.create_batch_ranges(start_block, end_block)
        ));
        
        let total_batches = work_queue.lock().await.len();
        info!("Split into {} batches for concurrent fetching", total_batches);
        
        // Create a shared counter for tracking progress
        let batches_completed = Arc::new(tokio::sync::Mutex::new(0));
        let total_blocks_fetched = Arc::new(tokio::sync::Mutex::new(0));
        
        
        // Create worker tasks that will continuously pull from the work queue
        let mut handles = Vec::with_capacity(self.max_concurrent_batches);
        
        for worker_id in 0..self.max_concurrent_batches {
            // Clone all the resources needed for this worker
            let provider = self.provider.clone();
            let block_queue = Arc::clone(&self.block_queue);
            let retry_delay = self.retry_delay;
            let max_retries = self.max_retries;
            let rpc_batch_size = self.rpc_batch_size;
            let worker_stagger_delay = self.worker_stagger_delay;
            let work_queue = Arc::clone(&work_queue);
            let batches_completed = Arc::clone(&batches_completed);
            let total_blocks_fetched = Arc::clone(&total_blocks_fetched);
            // Create worker-local reference to total_batches
            
            // Spawn a continuous worker that keeps pulling from the queue
            let handle = tokio::spawn(async move {
                // Add a staggered delay to prevent all workers from starting simultaneously
                // Each worker waits progressively longer based on the configured stagger delay
                let startup_delay = worker_id as u64 * worker_stagger_delay;
                info!("Worker {} waiting {}ms before starting to reduce initial RPC load", worker_id, startup_delay);
                sleep(Duration::from_millis(startup_delay)).await;
                
                info!("Starting worker {} for continuous batch processing", worker_id);
                
                // Create a dedicated fetcher for this worker
                let worker_fetcher = BlockFetcher {
                    provider,
                    block_queue,
                    rpc_batch_size,
                    max_concurrent_batches: 1, // Not used in worker
                    retry_delay,
                    max_retries,
                    worker_stagger_delay,  // Pass through stagger delay
                };
                
                // Keep pulling and processing batches until the queue is empty
                loop {
                    // Try to get the next batch from the queue
                    let next_batch = {
                        let mut queue = work_queue.lock().await;
                        queue.pop()
                    };
                    
                    match next_batch {
                        Some((batch_idx, batch_start, batch_end)) => {
                            // Got a batch to process
                            info!(
                                "Worker {} processing batch {}/{}: blocks {} to {}", 
                                worker_id, batch_idx + 1, total_batches, batch_start, batch_end
                            );
                            
                            // Process the batch
                            match worker_fetcher.fetch_batch(batch_start, batch_end).await {
                                Ok(blocks_fetched) => {
                                    // Update counters
                                    {
                                        let mut completed = batches_completed.lock().await;
                                        *completed += 1;
                                        
                                        let mut total = total_blocks_fetched.lock().await;
                                        *total += blocks_fetched;
                                        
                                        info!(
                                            "Worker {} completed batch {}/{}: {} blocks fetched ({}/{} blocks total, {:.1}%)", 
                                            worker_id, 
                                            batch_idx + 1, 
                                            total_batches, 
                                            blocks_fetched, 
                                            *total,
                                            total_blocks,
                                            (*total as f64 / total_blocks as f64) * 100.0
                                        );
                                    }
                                },
                                Err(e) => {
                                    error!(
                                        "Worker {} failed processing batch {}/{}: {}", 
                                        worker_id, batch_idx + 1, total_batches, e
                                    );
                                    
                                    // For serious errors, we might want to requeue the batch
                                    // But for now, we'll just count it as failed and move on
                                    let mut completed = batches_completed.lock().await;
                                    *completed += 1;
                                }
                            }
                        },
                        None => {
                            // No more batches to process, exit the worker loop
                            debug!("Worker {} found empty queue, exiting", worker_id);
                            break;
                        }
                    }
                }
                
                info!("Worker {} completed all assigned batches", worker_id);
            });
            
            handles.push(handle);
        }
        
        
        // Wait for all worker tasks to complete
        info!("Waiting for all {} workers to complete", handles.len());
        futures::future::join_all(handles).await;
        
        // Get final stats
        let batches_completed = *batches_completed.lock().await;
        let total_blocks_fetched = *total_blocks_fetched.lock().await;
        
        // Final throttle check
        self.throttle_if_queue_full().await;
        
        info!(
            "Completed fetching {} blocks in {} batches", 
            total_blocks_fetched, 
            batches_completed
        );
        
        Ok(())
    }
    
    /// Create a vector of batch ranges to process
    fn create_batch_ranges(&self, start_block: u64, end_block: u64) -> Vec<(usize, u64, u64)> {
        let mut batches = Vec::new();
        let mut current = start_block;
        let mut batch_idx = 0;
        
        while current <= end_block {
            let batch_end = std::cmp::min(current + self.rpc_batch_size as u64 - 1, end_block);
            batches.push((batch_idx, current, batch_end));
            current = batch_end + 1;
            batch_idx += 1;
        }
        
        batches
    }
    
    /// Fetch a batch of blocks and queue them for processing
    async fn fetch_batch(&self, start_block: u64, end_block: u64) -> Result<usize, SyncError> {
        info!("Fetching batch of blocks from {} to {}", start_block, end_block);
        
        let mut current_block = start_block;
        let mut blocks_fetched = 0;
        
        while current_block <= end_block {
            let batch_end = std::cmp::min(current_block + self.rpc_batch_size as u64 - 1, end_block);
            let blocks_in_batch = (batch_end - current_block + 1) as usize;
            
            debug!(
                "Fetching blocks {} to {} (batch size: {})",
                current_block, batch_end, blocks_in_batch
            );
            
            // Create a batch of requests
            let blocks = self.fetch_blocks_batch(current_block..=batch_end).await?;
            debug!("Fetched {} blocks from {} to {}", blocks.len(), current_block, batch_end);
            
            // Queue blocks for processing
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
                                blocks_fetched += 1;
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
                                    } else {
                                        blocks_fetched += 1;
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
        
        Ok(blocks_fetched)
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
            .filter_map(|(i, tx_hash)| {
                // Basic validation check
                if tx_hash.as_bytes().is_empty() {
                    warn!("Skipping transaction with empty hash in block {}", block_number);
                    return None;
                }
                
                Some(Transaction {
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
                })
            })
            .collect::<Vec<Transaction>>();
            
        // Get transaction count from actual collected transactions
        let tx_count = transactions.len() as u64;
        
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
            transaction_count: tx_count,
            transactions,
        })
    }
}