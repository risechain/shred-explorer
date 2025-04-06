use std::sync::Arc;
use anyhow::Result;
use tracing::{debug, error, info, warn};
use tokio::time::{Duration, sleep};
use ethers::providers::{Provider, Http, Ws, Middleware};
use ethers::types::BlockNumber;

use crate::db::Database;
use crate::models::{Block, Transaction};
use crate::utils::retry::with_retry;
use crate::sync::{SyncError, SharedSyncState};

/// Component responsible for live blockchain synchronization via WebSocket
pub struct LiveSync {
    provider_url: String, // Store URL for reconnection if needed
    db: Arc<Database>,
    sync_state: SharedSyncState,
    retry_delay: u64,
    max_retries: u32,
}

impl LiveSync {
    pub fn new(
        provider_url: String,
        db: Arc<Database>,
        sync_state: SharedSyncState,
    ) -> Self {
        Self {
            provider_url,
            db,
            sync_state,
            retry_delay: 1000, // Default 1 second
            max_retries: 5,    // Default 5 retries
        }
    }
    
    /// Configure retry settings
    pub fn with_retry_settings(mut self, retry_delay: u64, max_retries: u32) -> Self {
        self.retry_delay = retry_delay;
        self.max_retries = max_retries;
        self
    }
    
    /// Start live sync process
    pub async fn start(&self) -> Result<(), SyncError> {
        info!("Starting live sync");
        
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
            
            info!("Historical sync complete, starting live block monitoring for endpoint: {}", self.provider_url);
            
            // Start WebSocket connection and subscription
            match self.start_websocket_subscription().await {
                Ok(_) => {
                    // This should only return if the WebSocket connection was closed
                    warn!("WebSocket connection closed, will attempt to reconnect");
                    sleep(Duration::from_secs(5)).await;
                }
                Err(e) => {
                    error!("Error in WebSocket subscription: {}", e);
                    sleep(Duration::from_secs(5)).await;
                }
            }
        }
    }
    
    /// Start WebSocket subscription to new blocks
    async fn start_websocket_subscription(&self) -> Result<(), SyncError> {
        info!("Would connect to WebSocket endpoint: {}", self.provider_url);
        
        // Note: In a production environment, we would use a real WebSocket connection
        // with proper subscriptions to new blocks, but for this example we'll use polling
        info!("Using HTTP polling instead of WebSocket subscription");
        
        // Instead of a true WebSocket subscription, we'll poll for new blocks
        // This is a simplified implementation
        
        let mut last_block_number = {
            let state = self.sync_state.lock().await;
            state.latest_synced_block
        };
        
        // Simulate subscription by polling
        loop {
            // Create a temporary HTTP provider for each poll
            let provider_url = &self.provider_url;
            let http_provider = Provider::<Http>::try_from(provider_url.as_str())
                .map_err(|e| SyncError::WebSocket(format!("Failed to create HTTP provider: {}", e)))?;
            
            // Get the latest block number
            match http_provider.get_block_number().await {
                Ok(latest_number) => {
                    let latest_block = latest_number.as_u64();
                    
                    // If we have new blocks
                    if latest_block > last_block_number {
                        debug!("Found new block: {} (previous: {})", latest_block, last_block_number);
                        
                        // Process each new block (in a real implementation we'd process them in batches)
                        let block_to_process = last_block_number + 1;
                        debug!("Processing block {}", block_to_process);
                        
                        // Process this new block
                        match self.process_new_block_with_provider(&http_provider, block_to_process).await {
                            Ok(_) => {
                                debug!("Successfully processed block {}", block_to_process);
                                
                                // Update sync state with latest block
                                let mut state = self.sync_state.lock().await;
                                state.latest_synced_block = block_to_process;
                                last_block_number = block_to_process;
                            }
                            Err(e) => {
                                error!("Failed to process block {}: {}", block_to_process, e);
                                // Continue with next block
                            }
                        }
                    } else {
                        // No new blocks
                        debug!("No new blocks found. Current: {}", last_block_number);
                    }
                }
                Err(e) => {
                    error!("Error fetching latest block number: {}", e);
                    // Wait a bit before retrying
                    sleep(Duration::from_secs(5)).await;
                }
            }
            
            // Wait before polling again
            sleep(Duration::from_secs(2)).await;
        }
        Ok(())
    }
    
    /// Process a new block using an HTTP provider as fallback
    async fn process_new_block(&self, block_number: u64) -> Result<(), SyncError> {
        debug!("Processing new block {} using HTTP fallback", block_number);
        
        // Create a temporary HTTP provider
        let provider_url = &self.provider_url;
        let http_provider = Provider::<Http>::try_from(provider_url.as_str())
            .map_err(|e| SyncError::Provider(format!("Failed to create HTTP provider: {}", e)))?;
            
        // Process the block using the provider
        self.process_new_block_with_provider(&http_provider, block_number).await
    }
    
    /// Process a new block using the provided provider
    async fn process_new_block_with_provider<M: Middleware>(&self, provider: &M, block_number: u64) -> Result<(), SyncError> 
    where
        M::Error: std::fmt::Display
    {
        debug!("Fetching block {} details", block_number);
        
        let eth_block = with_retry(
            || async {
                // Fetch full block with transactions
                let block = provider.get_block_with_txs(BlockNumber::Number(block_number.into()))
                    .await
                    .map_err(|e| SyncError::Provider(format!("Failed to get block {}: {}", block_number, e)))?
                    .ok_or_else(|| SyncError::BlockNotFound(block_number))?;
                
                Ok::<_, SyncError>(block)
            },
            self.retry_delay,
            self.max_retries,
            &format!("fetch_live_block_{}", block_number),
        ).await?;
        
        // Convert to our model
        let transactions = eth_block.transactions.into_iter()
            .enumerate()
            .map(|(i, tx)| {
                Transaction {
                    hash: format!("{:?}", tx.hash),
                    from: Some(format!("{:?}", tx.from)),
                    to: tx.to.map(|addr| format!("{:?}", addr)),
                    value: tx.value.to_string(),
                    gas: tx.gas.as_u64(),
                    gas_price: tx.gas_price.map(|gp| gp.as_u64()),
                    input: format!("0x{}", hex::encode(tx.input.to_vec())),
                    nonce: tx.nonce.as_u64(),
                    transaction_index: i as u64,
                    block_hash: format!("{:?}", eth_block.hash.unwrap_or_default()),
                    block_number,
                }
            })
            .collect();
        
        let model_block = Block {
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
        };
        
        // Save to database
        debug!("Saving live block {} to database", block_number);
        self.db.save_block(&model_block).await
            .map_err(SyncError::from)?;
            
        info!("Live block {} processed successfully", block_number);
        Ok(())
    }
}