use std::sync::Arc;
use anyhow::Result;
use ethers::{
    providers::{Provider, Http, Ws, Middleware},
    types::{BlockNumber, Block as EthBlock, TxHash},
};
use futures::StreamExt; // Add this for .next() method
use tokio::time::{Duration, sleep};
use tracing::{debug, error, info, warn, instrument};

use crate::db::Database;
use crate::models::{Block, Transaction, BlockQueue, BlockProcessor};
use crate::utils::retry::with_retry;
use crate::sync::{SyncError, SharedSyncState};

/// Component responsible for live blockchain synchronization via WebSocket
#[derive(Clone)]
pub struct LiveSync {
    /// HTTP Provider URL for fetching block details
    http_provider_url: String,
    /// WebSocket Provider URL for subscribing to new blocks
    ws_provider_url: String,
    /// Database connection
    db: Arc<Database>,
    /// Shared state between sync components
    sync_state: SharedSyncState,
    /// Delay between retries in milliseconds
    retry_delay: u64,
    /// Maximum number of retries for operations
    max_retries: u32,
    /// Polling interval when WebSocket is not available (in seconds)
    polling_interval: u64,
    /// Maximum number of blocks processed in parallel when catching up
    max_parallel_blocks: usize,
    /// Block queue for decoupling processing from database writes
    block_queue: Arc<BlockQueue>,
    /// Block processor for database writes
    block_processor: Arc<BlockProcessor>,
}

impl LiveSync {
    /// Create a new LiveSync instance
    pub fn new(
        http_provider_url: String,
        ws_provider_url: String,
        db: Arc<Database>,
        sync_state: SharedSyncState,
    ) -> Self {
        info!("Creating LiveSync with HTTP: {}, WS: {}", http_provider_url, ws_provider_url);
        
        // Create block queue and processor
        let block_queue_size = 1000; // Default queue size
        let block_queue = Arc::new(BlockQueue::with_capacity(block_queue_size));
        let block_processor = Arc::new(BlockProcessor::new(block_queue.clone_queue()));
        
        Self {
            http_provider_url,
            ws_provider_url,
            db,
            sync_state,
            retry_delay: 200, // Default 200ms
            max_retries: 5,   // Default 5 retries
            polling_interval: 2, // Default 2 seconds
            max_parallel_blocks: 20, // Default max parallel blocks when catching up
            block_queue,
            block_processor,
        }
    }
    
    /// Configure retry settings
    #[allow(dead_code)]
    pub fn with_retry_settings(mut self, retry_delay: u64, max_retries: u32) -> Self {
        info!("Setting retry delay to {}ms and max retries to {}", retry_delay, max_retries);
        self.retry_delay = retry_delay;
        self.max_retries = max_retries;
        self
    }
    
    /// Configure polling interval
    pub fn with_polling_interval(mut self, seconds: u64) -> Self {
        info!("Setting polling interval to {}s", seconds);
        self.polling_interval = seconds;
        self
    }
    
    /// Configure maximum parallel blocks
    pub fn with_max_parallel_blocks(mut self, max_blocks: usize) -> Self {
        info!("Setting max parallel blocks to {}", max_blocks);
        self.max_parallel_blocks = max_blocks;
        self
    }
    
    /// Configure block queue size
    pub fn with_block_queue_size(self, queue_size: usize) -> Self {
        info!("Setting block queue size to {}", queue_size);
        
        // Create new block queue with specified size
        let block_queue = Arc::new(BlockQueue::with_capacity(queue_size));
        let block_processor = Arc::new(BlockProcessor::new(block_queue.clone_queue()));
        
        Self {
            http_provider_url: self.http_provider_url,
            ws_provider_url: self.ws_provider_url,
            db: self.db,
            sync_state: self.sync_state,
            retry_delay: self.retry_delay,
            max_retries: self.max_retries,
            polling_interval: self.polling_interval,
            max_parallel_blocks: self.max_parallel_blocks,
            block_queue,
            block_processor,
        }
    }
    
    /// Start the block processor with the specified number of workers
    pub async fn start_processor(&self, workers: usize) {
        info!("Starting live sync block processor with {} workers", workers);
        
        for i in 0..workers {
            info!("Starting live sync database worker {}", i + 1);
            let processor = Arc::clone(&self.block_processor);
            let db = Arc::clone(&self.db);
            processor.start(db).await;
        }
    }
    
    /// Start live sync process
    #[instrument(skip(self), name = "live_sync")]
    pub async fn start(&self) -> Result<(), SyncError> {
        info!("Starting live sync");
        
        // Start the database processors with default 2 workers
        self.start_processor(2).await;
        
        loop {
            // Check if we should start live sync
            let should_start = {
                let state = self.sync_state.lock().await;
                state.historic_sync_complete
            };
            
            if !should_start {
                debug!("Waiting for historical sync to complete before starting live sync");
                sleep(Duration::from_secs(5)).await;
                continue;
            }
            
            info!("Historical sync complete, starting live block monitoring");
            
            // Try websocket subscription first, fall back to polling if it fails
            match self.start_websocket_subscription().await {
                Ok(_) => {
                    // This should only return if the WebSocket connection was closed
                    warn!("WebSocket connection closed, will attempt to reconnect");
                    sleep(Duration::from_secs(5)).await;
                }
                Err(e) => {
                    error!("WebSocket subscription failed: {}, falling back to HTTP polling", e);
                    match self.start_http_polling().await {
                        Ok(_) => {
                            // This should only return if polling was stopped
                            warn!("HTTP polling stopped, will retry WebSocket");
                            sleep(Duration::from_secs(5)).await;
                        }
                        Err(e) => {
                            error!("HTTP polling failed: {}, will retry", e);
                            sleep(Duration::from_secs(5)).await;
                        }
                    }
                }
            }
        }
    }
    
    /// Start WebSocket subscription for new blocks
    #[instrument(skip(self), name = "ws_subscription")]
    async fn start_websocket_subscription(&self) -> Result<(), SyncError> {
        info!("Starting WebSocket subscription to new blocks: {}", self.ws_provider_url);
        
        // Connect to WebSocket
        let ws = Ws::connect(&self.ws_provider_url)
            .await
            .map_err(|e| SyncError::WebSocket(format!("Failed to connect: {}", e)))?;
            
        let provider = Provider::new(ws);
        
        // Create HTTP provider for fetching full block data
        let http_provider = self.create_http_provider()?;
        
        // Subscribe to new block headers
        let mut block_headers = provider.subscribe_blocks()
            .await
            .map_err(|e| SyncError::WebSocket(format!("Failed to subscribe to blocks: {}", e)))?;
        
        info!("Successfully subscribed to new blocks via WebSocket");
        
        // Track the last synced block number from the shared state
        let mut last_synced_block = {
            let state = self.sync_state.lock().await;
            state.latest_synced_block
        };
        
        // Get the current block number to check for gaps
        let current_block = self.get_latest_block_number(&http_provider).await?;
        
        // If we're behind, catch up first
        if current_block > last_synced_block + 1 {
            info!("Block gap detected. Last synced: {}, Current chain: {}. Catching up...",
                last_synced_block, current_block);
            
            self.catch_up_blocks(&http_provider, last_synced_block + 1, current_block).await?;
            
            // Update last synced block
            last_synced_block = current_block;
            
            // Update sync state
            let mut state = self.sync_state.lock().await;
            state.latest_synced_block = last_synced_block;
        }
        
        info!("Listening for new blocks in real-time. Last synced block: {}", last_synced_block);
        
        // Process incoming blocks
        while let Some(block) = block_headers.next().await {            
            let block_number = block.number
                .ok_or_else(|| SyncError::Parse("Block number missing".to_string()))?
                .as_u64();
                
            info!("Received new block notification: #{}", block_number);
            
            // If there's a gap, process missing blocks first
            if block_number > last_synced_block + 1 {
                let gap_start = last_synced_block + 1;
                let gap_end = block_number - 1;
                
                warn!("Block gap detected. Processing missing blocks {} to {}", gap_start, gap_end);
                
                self.catch_up_blocks(&http_provider, gap_start, gap_end).await?;
            }
            
            // WebSocket new_heads event doesn't include transaction data, so we need to fetch the block with transaction hashes
            info!("Fetching block data with transaction hashes for block #{}", block_number);
            
            // Enforce a small delay to reduce the "block out of range" error
            sleep(Duration::from_millis(300)).await;

            // Use the HTTP provider to fetch the block with transaction hashes
            let full_block = with_retry(
                || {
                    let http_provider = http_provider.clone();
                    let block_num = block_number;
                    
                    async move {
                        let block = http_provider.get_block(BlockNumber::Number(block_num.into()))
                            .await
                            .map_err(|e| SyncError::Provider(format!("Failed to get block {}: {}", block_num, e)))?
                            .ok_or_else(|| SyncError::BlockNotFound(block_num))?;
                            
                        Ok::<_, SyncError>(block)
                    }
                },
                self.retry_delay,
                self.max_retries,
                &format!("fetch_block_{}", block_number),
            ).await?;
            
            // Extract transaction count and transaction data
            let tx_count = full_block.transactions.len() as u64;
            info!("Block #{} contains {} transactions", block_number, tx_count);
            
            // Convert the block data to our model
            let model_block = self.convert_block_with_transactions(full_block)?;
            
            // Push to the queue using the helper method
            self.push_block_to_queue(model_block).await?;
            
            // Update the last synced block
            last_synced_block = block_number;
            
            // Update shared sync state
            let mut state = self.sync_state.lock().await;
            state.latest_synced_block = last_synced_block;
            
            // Monitor lag
            self.monitor_sync_status(&http_provider, last_synced_block).await?;
        }
        
        warn!("WebSocket subscription stream ended");
        Ok(())
    }
    
    /// Start HTTP polling for new blocks
    #[instrument(skip(self), name = "http_polling")]
    async fn start_http_polling(&self) -> Result<(), SyncError> {
        info!("Starting HTTP polling for new blocks: {}", self.http_provider_url);
        
        // Create HTTP provider
        let http_provider = self.create_http_provider()?;
        
        // Get the last synced block from shared state
        let mut last_synced_block = {
            let state = self.sync_state.lock().await;
            state.latest_synced_block
        };
        
        info!("HTTP polling started. Last synced block: {}", last_synced_block);
        
        // Polling loop
        loop {
            // Get the latest block on chain
            let latest_block_number = match self.get_latest_block_number(&http_provider).await {
                Ok(num) => num,
                Err(e) => {
                    error!("Failed to get latest block number: {}", e);
                    sleep(Duration::from_secs(self.polling_interval)).await;
                    continue;
                }
            };
            
            // If we found new blocks
            if latest_block_number > last_synced_block {
                let blocks_behind = latest_block_number - last_synced_block;
                info!("Found new blocks. Currently {} blocks behind. Chain head: {}", 
                    blocks_behind, latest_block_number);
                
                // Process blocks
                self.catch_up_blocks(&http_provider, last_synced_block + 1, latest_block_number).await?;
                
                // Update the last synced block
                last_synced_block = latest_block_number;
                
                // Update shared sync state
                let mut state = self.sync_state.lock().await;
                state.latest_synced_block = last_synced_block;
                
                // If we caught up, wait for the polling interval
                if blocks_behind <= 1 {
                    debug!("Caught up with chain head. Waiting for next polling interval.");
                    sleep(Duration::from_secs(self.polling_interval)).await;
                }
                // If we're still behind, continue immediately
            } else {
                // No new blocks, wait for polling interval
                debug!("No new blocks found. Current: {}", last_synced_block);
                sleep(Duration::from_secs(self.polling_interval)).await;
            }
            
            // Monitor lag
            self.monitor_sync_status(&http_provider, last_synced_block).await?;
        }
    }
    
    /// Process blocks in parallel to catch up quickly
    #[instrument(skip(self, provider), fields(start_block = %start_block, end_block = %end_block), name = "catch_up_blocks")]
    async fn catch_up_blocks<M: Middleware + Clone + 'static>(&self, provider: &M, start_block: u64, end_block: u64) -> Result<(), SyncError> 
    where
        M::Error: std::fmt::Display
    {
        let blocks_to_process = end_block - start_block + 1;
        
        info!("Catching up {} blocks from {} to {}", blocks_to_process, start_block, end_block);
        
        // For a small number of blocks, process sequentially
        if blocks_to_process <= 3 {
            for block_number in start_block..=end_block {
                self.process_block(provider, block_number).await?;
            }
            return Ok(());
        }
        
        // For larger batches, process in parallel with a limit on concurrency
        let batch_size = std::cmp::min(self.max_parallel_blocks, blocks_to_process as usize);
        info!("Processing a batch of {} blocks in parallel", batch_size);
        
        let mut tasks = Vec::with_capacity(batch_size);
        let mut blocks_processed = 0;
        let mut current_block = start_block;
        
        // Process blocks in chunks of max_parallel_blocks
        while current_block <= end_block {
            // Clear previous tasks
            tasks.clear();
            
            // Determine the end of this batch
            let batch_end = std::cmp::min(current_block + batch_size as u64 - 1, end_block);
            
            // Create tasks for this batch
            for block_number in current_block..=batch_end {
                let provider_clone = provider.clone();
                let self_clone = self.clone();
                
                let task = tokio::spawn(async move {
                    match self_clone.process_block(&provider_clone, block_number).await {
                        Ok(_) => {
                            debug!("Successfully processed block {}", block_number);
                            Ok(block_number)
                        }
                        Err(e) => {
                            error!("Failed to process block {}: {}", block_number, e);
                            Err(e)
                        }
                    }
                });
                
                tasks.push(task);
            }
            
            // Wait for all tasks in this batch to complete
            for task in futures::future::join_all(tasks.drain(..)).await {
                match task {
                    Ok(Ok(block_number)) => {
                        blocks_processed += 1;
                        debug!("Block {} successfully processed", block_number);
                    }
                    Ok(Err(e)) => {
                        error!("Error processing block: {}", e);
                    }
                    Err(e) => {
                        error!("Task panicked: {}", e);
                    }
                }
            }
            
            // Move to the next batch
            current_block = batch_end + 1;
            
            // Log progress
            let progress_percent = (blocks_processed as f64 / blocks_to_process as f64) * 100.0;
            info!("Catch-up progress: {}/{} blocks processed ({:.1}%)", 
                blocks_processed, blocks_to_process, progress_percent);
        }
        
        info!("Catch-up complete! Processed {} blocks from {} to {}", blocks_processed, start_block, end_block);
        Ok(())
    }
    
    /// Check the current sync status and log how far behind we are
    #[instrument(skip(self, provider), name = "monitor_sync_status")]
    async fn monitor_sync_status<M: Middleware>(&self, provider: &M, last_synced_block: u64) -> Result<(), SyncError> 
    where
        M::Error: std::fmt::Display
    {
        let latest_block = match self.get_latest_block_number(provider).await {
            Ok(num) => num,
            Err(e) => {
                warn!("Failed to get latest block for sync status check: {}", e);
                return Ok(());
            }
        };
        
        let blocks_behind = latest_block.saturating_sub(last_synced_block);
        
        // Log sync status with appropriate level based on lag
        if blocks_behind == 0 {
            debug!("Fully synced with chain head: Block #{}", latest_block);
        } else if blocks_behind <= 2 {
            info!("Near sync: {} blocks behind chain head (synced: {}, latest: {})",
                blocks_behind, last_synced_block, latest_block);
        } else if blocks_behind <= 10 {
            warn!("Moderate lag: {} blocks behind chain head (synced: {}, latest: {})",
                blocks_behind, last_synced_block, latest_block);
        } else {
            error!("Significant lag: {} blocks behind chain head (synced: {}, latest: {})",
                blocks_behind, last_synced_block, latest_block);
        }
        
        Ok(())
    }
    
    /// Create an HTTP provider
    fn create_http_provider(&self) -> Result<Provider<Http>, SyncError> {
        Provider::<Http>::try_from(self.http_provider_url.as_str())
            .map_err(|e| SyncError::Provider(format!("Failed to create HTTP provider: {}", e)))
    }
    
    /// Push a block to the processing queue with retry logic
    async fn push_block_to_queue(&self, model_block: Block) -> Result<(), SyncError> {
        let block_number = model_block.number;
        debug!("Queueing block {} for database storage", block_number);
        
        // Try to push to the queue with retries
        let mut retry_count = 0;
        let max_push_retries = 5;
        
        loop {
            let push_result = self.block_queue.try_push(model_block.clone());
            
            if push_result {
                // Successfully pushed to queue
                debug!("Block {} successfully queued for storage", block_number);
                break;
            } else {
                // Queue is full
                retry_count += 1;
                
                if retry_count >= max_push_retries {
                    // Too many retries, use blocking push
                    warn!("Queue still full after {} retries, using blocking push for block {}", 
                        max_push_retries, block_number);
                        
                    if let Err(e) = self.block_queue.push(model_block).await {
                        error!("Failed to push block {} to queue: {}", block_number, e);
                        return Err(SyncError::Other(format!("Failed to queue block {}: {}", block_number, e)));
                    }
                    break;
                }
                
                // Wait before retrying
                warn!("Queue full, waiting before retry {}/{} for block {}", 
                    retry_count, max_push_retries, block_number);
                sleep(Duration::from_millis(100 * retry_count as u64)).await;
            }
        }
        
        Ok(())
    }
    
    /// Get the latest block number from the chain
    #[instrument(skip(self, provider), name = "get_latest_block")]
    async fn get_latest_block_number<M: Middleware>(&self, provider: &M) -> Result<u64, SyncError> 
    where
        M::Error: std::fmt::Display
    {
        debug!("Fetching latest block number from chain");
        
        with_retry(
            || async {
                provider.get_block_number().await
                    .map_err(|e| SyncError::Provider(format!("Failed to get latest block number: {}", e)))
            },
            100,
            self.max_retries,
            "fetch_latest_block_number"
        ).await
        .map(|number| number.as_u64())
    }
    
    /// Process a single block with transaction hashes and queue it for database storage
    #[instrument(skip(self, provider), name = "process_block")]
    async fn process_block<M: Middleware>(&self, provider: &M, block_number: u64) -> Result<(), SyncError> 
    where
        M::Error: std::fmt::Display
    {
        debug!("Fetching block {}", block_number);
        
        let eth_block = with_retry(
            || async {
                // Fetch block with transaction hashes
                let block = provider.get_block(BlockNumber::Number(block_number.into()))
                    .await
                    .map_err(|e| SyncError::Provider(format!("Failed to get block {}: {}", block_number, e)))?
                    .ok_or_else(|| SyncError::BlockNotFound(block_number))?;
                
                Ok::<_, SyncError>(block)
            },
            self.retry_delay,
            self.max_retries,
            &format!("fetch_block_{}", block_number),
        ).await?;
        
        // Count transactions
        let tx_count = eth_block.transactions.len() as u64;
        debug!("Block {} contains {} transactions", block_number, tx_count);
        
        // Convert to our model
        let model_block = self.convert_block_with_transactions(eth_block)?;
        
        // Queue block for database storage using the helper method
        self.push_block_to_queue(model_block).await?;
            
        info!("Block {} processed successfully with {} transactions", block_number, tx_count);
        Ok(())
    }
    
    /// Wait for the block queue to be fully processed
    #[allow(dead_code)]
    pub async fn wait_for_queue_to_empty(&self) -> Result<(), SyncError> {
        info!("Waiting for live sync block queue to be fully processed...");
        
        let max_wait_time = Duration::from_secs(600); // 10 minutes max wait time
        let start_time = tokio::time::Instant::now();
        
        while !self.block_queue.is_empty() {
            // Check if we've exceeded the maximum wait time
            if start_time.elapsed() > max_wait_time {
                warn!("Timed out waiting for block queue to empty after {} seconds", max_wait_time.as_secs());
                return Err(SyncError::Other("Timed out waiting for block queue to empty".to_string()));
            }
            
            // Log progress every 10 seconds
            if start_time.elapsed().as_secs() % 10 == 0 {
                info!("Still waiting for block queue to empty, current size: {}/{}", 
                    self.block_queue.len(), self.block_queue.capacity());
            }
            
            sleep(Duration::from_millis(500)).await;
        }
        
        info!("Live sync block queue fully processed");
        Ok(())
    }
    
    /// Convert block with just transaction hashes to our model
    fn convert_block_with_transactions(&self, eth_block: EthBlock<TxHash>) -> Result<Block, SyncError> {
        let block_number = eth_block.number
            .ok_or_else(|| SyncError::Parse("Block number missing".to_string()))?
            .as_u64();
            
        debug!("Converting block {} to model", block_number);
        
        // Convert transaction hashes to our transaction model
        let transactions = eth_block.transactions.into_iter()
            .enumerate()
            .filter_map(|(i, tx)| {
                // Basic validation check
                if tx.as_bytes().is_empty() {
                    warn!("Skipping transaction with empty hash in block {}", block_number);
                    return None;
                }
                
                Some(Transaction {
                    hash: format!("{:?}", tx),
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
        
        let tx_count = transactions.len() as u64;  // Recount to ensure accuracy
        
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
            extra_data: format!("0x{}", hex::encode(&eth_block.extra_data)),
            miner: format!("{:?}", eth_block.author.unwrap_or_default()),
            difficulty: eth_block.difficulty,
            total_difficulty: eth_block.total_difficulty,
            size: eth_block.size.unwrap_or_default().as_u64(),
            transaction_count: tx_count,
            transactions,
        })
    }
}