use anyhow::{Result, Context};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};
use ethers::providers::{Provider, Http, Middleware};

mod config;
mod db;
mod models;
mod sync;
mod utils;

/// Helper function to get the latest block number from the chain
async fn historic_sync_get_latest_block(config: &Config) -> Result<u64> {
    // Create a temporary HTTP provider
    let provider = Provider::<Http>::try_from(config.http_provider_url.clone())
        .context("Failed to create HTTP provider")?;
        
    // Fetch the latest block number
    let block_number = provider.get_block_number().await
        .context("Failed to get latest block number")?;
        
    Ok(block_number.as_u64())
}

use config::Config;
use db::Database;
use sync::{HistoricSync, LiveSync, SyncManager};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    utils::logger::init_logger();
    info!("Starting Ethereum indexer");

    // Load configuration
    let config = Config::load().expect("Failed to load configuration");
    info!("Configuration loaded");

    // Initialize database connection
    let db = Database::new(&config.database_url).await?
        .migrate()
        .await?;
    info!("Database connection established and migrations applied");

    // Log configuration settings
    utils::config_logger::log_config(&config);
    
    // Create sync components
    let db_arc = Arc::new(db);
    
    // Get the latest block number from the chain
    let current_chain_tip = historic_sync_get_latest_block(&config).await?;
    info!("Current chain tip: {}", current_chain_tip);
    
    // Determine start block based on configuration and DB state
    let latest_synced_block = match db_arc.get_latest_block_number().await? {
        Some(block_number) => {
            info!("Found latest synced block in database: {}", block_number);
            
            // If blocks_from_tip is set, calculate starting point
            if let Some(blocks_from_tip) = config.blocks_from_tip {
                let calculated_start = if current_chain_tip > blocks_from_tip {
                    current_chain_tip - blocks_from_tip
                } else {
                    0 // If blocks_from_tip is larger than chain length, start from 0
                };
                
                // Use the max of config.start_block, calculated_start, and block_number
                let start = calculated_start.max(config.start_block).max(block_number);
                
                if start != block_number {
                    info!("Starting from block {} (blocks_from_tip: {}, chain tip: {})", 
                          start, blocks_from_tip, current_chain_tip);
                    start
                } else {
                    info!("Continuing from last synced block: {}", block_number);
                    block_number
                }
            } else {
                info!("Continuing from last synced block: {}", block_number);
                block_number
            }
        },
        None => {
            // No blocks in DB yet
            if let Some(blocks_from_tip) = config.blocks_from_tip {
                let calculated_start = if current_chain_tip > blocks_from_tip {
                    current_chain_tip - blocks_from_tip
                } else {
                    0
                };
                
                let start = calculated_start.max(config.start_block);
                info!("No blocks found in database, starting from block {} (blocks_from_tip: {}, chain tip: {})", 
                      start, blocks_from_tip, current_chain_tip);
                start
            } else {
                info!("No blocks found in database, starting from configured block: {}", config.start_block);
                config.start_block
            }
        }
    };
    
    let sync_state = Arc::new(Mutex::new(sync::SyncState::new(latest_synced_block)));
    
    let mut historic_sync = HistoricSync::new(
        config.http_provider_url.clone(),
        Some(config.ws_provider_url.clone()),
        db_arc.clone(),
        sync_state.clone(),
        config.batch_size,
        config.max_concurrent_requests,
        config.block_queue_size,
    ).expect("Failed to create historic sync component");
    
    // Configure settings for the historic sync
    historic_sync = historic_sync
        .with_rpc_batch_size(config.rpc_batch_size)
        .with_retry_settings(config.retry_delay, config.max_retries)
        .with_max_concurrent_batches(config.max_concurrent_batches);
        
    // Start the database processor workers
    historic_sync.start_processor(config.db_workers).await;
    
    let live_sync = LiveSync::new(
        config.http_provider_url.clone(),
        config.ws_provider_url.clone(),
        db_arc.clone(),
        sync_state.clone(),
    )
    .with_polling_interval(2) // 2 seconds polling interval for HTTP fallback
    .with_max_parallel_blocks(20) // Process up to 20 blocks in parallel when catching up
    .with_block_queue_size(config.block_queue_size); // Use the same queue size as historic sync

    // Create sync manager
    let sync_manager = SyncManager::new(historic_sync, live_sync);

    // Start syncing
    match sync_manager.start().await {
        Ok(_) => info!("Indexer shutdown gracefully"),
        Err(e) => error!("Indexer failed: {}", e),
    }

    Ok(())
}
