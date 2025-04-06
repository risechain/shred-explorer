use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};

mod config;
mod db;
mod models;
mod sync;
mod utils;

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
    
    // Check database for latest synced block first
    let latest_synced_block = match db_arc.get_latest_block_number().await? {
        Some(block_number) => {
            info!("Found latest synced block in database: {}", block_number);
            block_number
        },
        None => {
            info!("No blocks found in database, starting from configured block: {}", config.start_block);
            config.start_block
        }
    };
    
    let sync_state = Arc::new(Mutex::new(sync::SyncState::new(latest_synced_block)));
    
    let mut historic_sync = HistoricSync::new(
        config.http_provider_url.clone(),
        db_arc.clone(),
        sync_state.clone(),
        config.batch_size,
        config.max_concurrent_requests,
        config.block_queue_size,
    ).expect("Failed to create historic sync component");
    
    // Configure RPC batch size and retry settings
    historic_sync = historic_sync
        .with_rpc_batch_size(config.rpc_batch_size)
        .with_retry_settings(config.retry_delay, config.max_retries);
        
    // Start the database processor workers
    historic_sync.start_processor(config.db_workers).await;
    
    let live_sync = LiveSync::new(
        config.ws_provider_url.clone(),
        db_arc.clone(),
        sync_state.clone(),
    );

    // Create sync manager
    let sync_manager = SyncManager::new(historic_sync, live_sync);

    // Start syncing
    match sync_manager.start().await {
        Ok(_) => info!("Indexer shutdown gracefully"),
        Err(e) => error!("Indexer failed: {}", e),
    }

    Ok(())
}
