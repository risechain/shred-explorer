use anyhow::{Context, Result};
use serde::Deserialize;
use std::env;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub database_url: String,
    pub http_provider_url: String,
    pub ws_provider_url: String,
    pub start_block: u64,
    pub batch_size: usize,
    pub max_concurrent_requests: usize,
    pub retry_delay: u64,
    pub max_retries: u32,
    pub rpc_batch_size: usize,
    pub block_queue_size: usize,
    pub db_workers: usize,
}

impl Config {
    pub fn load() -> Result<Self> {
        // Load .env file if it exists
        let _ = dotenv::dotenv();

        let database_url = env::var("DATABASE_URL")
            .context("DATABASE_URL must be set")?;

        let http_provider_url = env::var("HTTP_PROVIDER_URL")
            .context("HTTP_PROVIDER_URL must be set")?;

        let ws_provider_url = env::var("WS_PROVIDER_URL")
            .context("WS_PROVIDER_URL must be set")?;

        let start_block = env::var("START_BLOCK")
            .unwrap_or_else(|_| "0".to_string())
            .parse()
            .context("START_BLOCK must be a valid number")?;

        let batch_size = env::var("BATCH_SIZE")
            .unwrap_or_else(|_| "100".to_string())
            .parse()
            .context("BATCH_SIZE must be a valid number")?;

        let max_concurrent_requests = env::var("MAX_CONCURRENT_REQUESTS")
            .unwrap_or_else(|_| "10".to_string())
            .parse()
            .context("MAX_CONCURRENT_REQUESTS must be a valid number")?;

        let retry_delay = env::var("RETRY_DELAY")
            .unwrap_or_else(|_| "1000".to_string()) // Default 1 second in ms
            .parse()
            .context("RETRY_DELAY must be a valid number")?;

        let max_retries = env::var("MAX_RETRIES")
            .unwrap_or_else(|_| "5".to_string())
            .parse()
            .context("MAX_RETRIES must be a valid number")?;
            
        let rpc_batch_size = env::var("RPC_BATCH_SIZE")
            .unwrap_or_else(|_| "10".to_string()) // Default to 10 blocks per RPC batch
            .parse()
            .context("RPC_BATCH_SIZE must be a valid number")?;
            
        let block_queue_size = env::var("BLOCK_QUEUE_SIZE")
            .unwrap_or_else(|_| "1000".to_string()) // Default to 1000 blocks in queue
            .parse()
            .context("BLOCK_QUEUE_SIZE must be a valid number")?;
            
        let db_workers = env::var("DB_WORKERS")
            .unwrap_or_else(|_| "2".to_string()) // Default to 2 database worker threads
            .parse()
            .context("DB_WORKERS must be a valid number")?;

        Ok(Config {
            database_url,
            http_provider_url,
            ws_provider_url,
            start_block,
            batch_size,
            max_concurrent_requests,
            retry_delay,
            max_retries,
            rpc_batch_size,
            block_queue_size,
            db_workers,
        })
    }
}
