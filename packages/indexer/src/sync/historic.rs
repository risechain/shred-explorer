use std::sync::Arc;
use anyhow::Result;
use tracing::{debug, error, info, warn};
use ethers::providers::{Provider, Http, Middleware};
use ethers::types::BlockNumber;
use tokio::time::{sleep, Duration, Instant};
use tokio::task::JoinHandle;

use crate::db::Database;
use crate::models::{Block, Transaction, BlockQueue, BlockProcessor};
use crate::utils::retry::with_retry;
use crate::utils::time::{format_duration, format_rate};
use crate::sync::{SyncError, SharedSyncState, BlockFetcher};

/// Component responsible for historical sync
pub struct HistoricSync {
    provider: Provider<Http>, // Keep HTTP provider for fallback purposes
    ws_provider_url: String,  // WebSocket URL for creating WS connections
    db: Arc<Database>,
    sync_state: SharedSyncState,
    batch_size: usize,
    _max_concurrent_requests: usize, // Kept for future use
    retry_delay: u64,
    max_retries: u32,
    rpc_batch_size: usize,
    block_queue: Arc<BlockQueue>,
    block_processor: Arc<BlockProcessor>,
    max_concurrent_batches: usize,
}

impl HistoricSync {
    pub fn new(
        provider_url: String,
        ws_provider_url: Option<String>,
        db: Arc<Database>,
        sync_state: SharedSyncState,
        batch_size: usize,
        _max_concurrent_requests: usize, // Kept for future use
        block_queue_size: usize,
    ) -> Result<Self, SyncError> {
        // Create an HTTP provider with ethers
        let provider = Provider::<Http>::try_from(provider_url.clone())
            .map_err(|e| SyncError::Provider(format!("Failed to create HTTP provider: {}", e)))?;
            
        // Store the WebSocket URL - convert http to ws if not provided
        let ws_provider_url = if let Some(ws_url) = ws_provider_url {
            ws_url
        } else {
            // Convert HTTP URL to WebSocket URL if not explicitly provided
            if provider_url.starts_with("http://") {
                provider_url.replace("http://", "ws://")
            } else if provider_url.starts_with("https://") {
                provider_url.replace("https://", "wss://")
            } else {
                // If no scheme, assume it needs ws:// prefix
                format!("ws://{}", provider_url)
            }
        };
            
        // Create the block queue
        let block_queue = Arc::new(BlockQueue::with_capacity(block_queue_size));
        info!("Created block queue with capacity {}", block_queue_size);
        
        // Create block processor
        let block_processor = Arc::new(BlockProcessor::new(block_queue.clone_queue()));
        info!("Created block processor");
        
        info!("WebSocket URL: {}", ws_provider_url);
            
        Ok(Self {
            provider,
            ws_provider_url,
            db: db.clone(),
            sync_state,
            batch_size,
            _max_concurrent_requests,
            retry_delay: 1000, // Default 1 second
            max_retries: 5,    // Default 5 retries
            rpc_batch_size: 10, // Default 10 blocks per RPC batch
            block_queue,
            block_processor,
            max_concurrent_batches: 5, // Default to 5 concurrent batches
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
    
    /// Configure maximum concurrent batches
    pub fn with_max_concurrent_batches(mut self, max_concurrent_batches: usize) -> Self {
        info!("Setting maximum concurrent batches to {}", max_concurrent_batches);
        self.max_concurrent_batches = max_concurrent_batches;
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
        
        // Create block fetcher using WebSocket connection
        info!("Creating block fetcher with WebSocket connection");
        let fetcher = match BlockFetcher::from_ws_url(
            &self.ws_provider_url,
            Arc::clone(&self.block_queue),
            self.rpc_batch_size,
            self.retry_delay,
            self.max_retries,
        ).await {
            Ok(fetcher) => fetcher
                .with_max_concurrent_batches(self.max_concurrent_batches)
                .with_worker_stagger_delay(100), // Add a 100ms stagger between worker startup
            Err(e) => {
                // If WebSocket connection fails, fall back to HTTP
                warn!("Failed to create WebSocket fetcher: {}. Falling back to HTTP", e);
                
                // We don't currently have a way to create an HTTP fetcher directly in the new architecture
                // So we'll need to implement that path
                return Err(SyncError::Provider(format!("WebSocket connection failed and HTTP fallback not implemented yet: {}", e)));
            }
        };
        
        // Start the ETA monitoring worker
        let eta_monitor_handle = self.start_eta_monitor(
            start_block, 
            latest_block_number, 
            Arc::clone(&self.sync_state)
        );
        
        // Process blocks in batches using concurrent fetching
        self.process_blocks_concurrent(start_block, latest_block_number, &fetcher).await?;
        
        // Stop the ETA monitor
        eta_monitor_handle.abort();
        
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
    
    /// Start a worker that monitors sync progress and calculates ETA
    fn start_eta_monitor(
        &self,
        initial_block: u64,
        target_block: u64,
        sync_state: SharedSyncState,
    ) -> JoinHandle<()> {
        // Clone what we need for the worker
        let provider = self.provider.clone();
        let retry_delay = self.retry_delay;
        let max_retries = self.max_retries;
        
        // Store the total blocks to sync
        let total_blocks = target_block.saturating_sub(initial_block) + 1;
        
        // Create a very visible separator for startup
        let separator = "=".repeat(80);
        info!("\n\n{}\n{}\n{}", 
            separator, 
            "                     SYNC MONITOR STARTING UP", 
            separator
        );
        info!("⏲️  ETA monitor will update every 30 seconds with sync progress information");
        info!("{}\n", separator);
        
        // Launch the worker
        tokio::spawn(async move {
            // Record start time and initial values
            let start_time = Instant::now();
            let mut last_check_time = start_time;
            let mut last_synced_block = initial_block;
            
            // We'll calculate rates based on the last interval
            
            // Wait for 30 seconds before first check
            sleep(Duration::from_secs(30)).await;
            
            loop {
                // Get the current block
                let current_chain_tip = match with_retry(
                    || async {
                        let block = provider.get_block_number().await
                            .map_err(|e| SyncError::Provider(format!("Failed to get block number: {}", e)))?;
                        Ok::<_, SyncError>(block.as_u64())
                    },
                    retry_delay,
                    max_retries,
                    "eta_monitor_get_latest_block",
                ).await {
                    Ok(tip) => tip,
                    Err(e) => {
                        warn!("ETA monitor failed to get latest block: {}", e);
                        // Just use the target as fallback - not super accurate but better than nothing
                        target_block
                    }
                };
                
                // Check if the target has moved (chain advanced)
                let new_total_blocks = if current_chain_tip > target_block {
                    current_chain_tip.saturating_sub(initial_block) + 1
                } else {
                    total_blocks
                };
                
                // Note: last_check_time is used to calculate short-term rate
                
                // Get the current synced block position
                let current_synced_block = {
                    let state = sync_state.lock().await;
                    state.latest_synced_block
                };
                
                // Get the current time
                let now = Instant::now();
                
                // Calculate remaining blocks
                let blocks_remaining = current_chain_tip.saturating_sub(current_synced_block);
                let blocks_synced_total = current_synced_block.saturating_sub(initial_block);
                let progress_pct = (blocks_synced_total as f64 / new_total_blocks as f64) * 100.0;
                
                // Calculate short-term rate (blocks per second) - last 30 seconds
                let blocks_synced_short = current_synced_block.saturating_sub(last_synced_block);
                let short_term_seconds = now.saturating_duration_since(last_check_time).as_secs_f64();
                let short_term_rate = if short_term_seconds > 0.0 {
                    blocks_synced_short as f64 / short_term_seconds
                } else {
                    0.0
                };
                
                // Calculate overall rate (blocks per second) - since start
                let total_seconds = now.saturating_duration_since(start_time).as_secs_f64();
                let overall_rate = if total_seconds > 0.0 {
                    blocks_synced_total as f64 / total_seconds
                } else {
                    0.0
                };
                
                // Calculate ETAs
                let short_term_eta = if short_term_rate > 0.0 {
                    blocks_remaining as f64 / short_term_rate
                } else {
                    0.0
                };
                
                let overall_eta = if overall_rate > 0.0 {
                    blocks_remaining as f64 / overall_rate
                } else {
                    0.0
                };
                
                // Create a very visible separator
                let separator = "=".repeat(80);
                
                // Log the ETA information with eye-catching formatting
                info!("\n\n{}\n{}\n{}", separator, "                          SYNC PROGRESS REPORT", separator);
                
                // Main progress stats
                info!("📊 PROGRESS: {}/{} blocks ({:.2}%)", 
                    blocks_synced_total, new_total_blocks, progress_pct);
                
                info!("🔄 REMAINING: {} blocks", blocks_remaining);
                
                // Short-term ETA (more responsive to recent performance)
                info!("⚡ RECENT RATE: {} (last 30s)", format_rate(short_term_rate));
                info!("⏱️  SHORT-TERM ETA: {}", 
                    if short_term_eta > 0.0 { 
                        format_duration(short_term_eta)
                    } else {
                        "Unknown".to_string()
                    });
                
                // Overall ETA (more stable average)
                info!("🚀 AVERAGE RATE: {} (entire sync)", format_rate(overall_rate));
                info!("⏰ OVERALL ETA: {}", 
                    if overall_eta > 0.0 {
                        format_duration(overall_eta) 
                    } else {
                        "Unknown".to_string()
                    });
                
                // End separator
                info!("{}\n", separator);
                
                // Update for next check
                last_check_time = now;
                last_synced_block = current_synced_block;
                
                // If sync is complete, stop monitoring
                if current_synced_block >= current_chain_tip {
                    // Create a very visible separator for shutdown
                    let end_separator = "=".repeat(80);
                    info!("\n\n{}\n{}\n{}", 
                        end_separator, 
                        "                     SYNC MONITOR SHUTTING DOWN - SYNC COMPLETE", 
                        end_separator
                    );
                    info!("✅ Successfully synced all {} blocks! Current block: {}", 
                        blocks_synced_total, current_synced_block);
                    info!("🚀 Final average speed: {}", format_rate(overall_rate));
                    info!("⏱️  Total sync time: {}", format_duration(total_seconds));
                    info!("{}\n", end_separator);
                    break;
                }
                
                // Wait for the next check
                sleep(Duration::from_secs(30)).await;
            }
        })
    }
    
    
    /// Process blocks from start to end using concurrent fetching
    async fn process_blocks_concurrent(&self, start_block: u64, end_block: u64, fetcher: &BlockFetcher) -> Result<(), SyncError> {
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
            
            info!(
                "Using concurrent fetcher to process blocks from {} to {}", 
                current_block, 
                batch_end
            );
            
            // Use the fetcher to concurrently fetch all blocks in this batch
            fetcher.fetch_blocks_range(current_block, batch_end).await?;
            
            // Update processed count
            processed_blocks += batch_size;
            
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
    #[allow(dead_code)]
    async fn process_block_chunk(&self, start_block: u64, end_block: u64) -> Result<(), SyncError> {
        let _total_blocks = end_block - start_block + 1;
        let mut current_block = start_block;
        
        while current_block <= end_block {
            let batch_end = std::cmp::min(current_block + self.rpc_batch_size as u64 - 1, end_block);
            let _blocks_in_batch = (batch_end - current_block + 1) as usize;
            
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
                    Ok(mut model_block) => {
                        // Validate transactions before pushing to queue
                        // Sometimes the RPC node can return malformed transaction data
                        model_block.transactions.retain(|tx| {
                            // Keep only transactions with valid data
                            if tx.hash.is_empty() {
                                warn!("Dropping transaction with empty hash in block {}", model_block.number);
                                return false;
                            }
                            true
                        });
                        
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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
    fn convert_block(&self, eth_block: ethers::types::Block<ethers::types::H256>) -> Result<Block, SyncError> {
        let block_number = eth_block.number
            .ok_or_else(|| SyncError::Parse("Block number missing".to_string()))?
            .as_u64();
        
        debug!("Converting block {} to model", block_number);
        
        // Get transaction count from the block
        let tx_count = eth_block.transactions.len() as u64;
        
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
            transaction_count: tx_count,
            transactions,
        })
    }
}