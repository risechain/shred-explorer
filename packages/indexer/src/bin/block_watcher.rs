use anyhow::Result;
use chrono::{DateTime, Utc};
use colored::Colorize;
use serde::Deserialize;
use sqlx::{
    postgres::{PgListener, PgPool},
};
use std::{env, time::Duration};
use tracing::{error, info, warn};
use tracing_subscriber::fmt::format::FmtSpan;

#[derive(Debug, Deserialize)]
struct BlockNotification {
    number: u64,
    hash: String,
    timestamp: u64,
    transaction_count: u64,
}

/// Initialize a simple console logger
fn init_logger() {
    let subscriber = tracing_subscriber::FmtSubscriber::builder()
        .with_env_filter("info")
        .with_span_events(FmtSpan::CLOSE)
        .finish();

    tracing::subscriber::set_global_default(subscriber).expect("Failed to set up logging");
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    init_logger();

    // Print banner
    println!("{}", "=".repeat(80).bright_blue());
    println!("{}", "ETHEREUM BLOCK WATCHER".bold().bright_green());
    println!("{}", "Real-time monitoring of new blocks".bright_cyan());
    println!("{}", "=".repeat(80).bright_blue());
    println!();

    // Load environment variables from .env file if present
    dotenv::dotenv().ok();

    // Get database URL from environment variable or use default
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/postgres".to_string());

    info!("Connecting to database at: {}", database_url);
    
    // Create a connection pool
    let pool = connect_to_database(&database_url).await?;
    
    // Subscribe to new block notifications
    info!("Setting up notification listener...");
    let mut listener = subscribe_to_blocks(&pool).await?;
    
    info!("Listening for new block notifications");
    println!("\n{}", "Waiting for new blocks to be indexed...".bright_yellow());
    
    // Main loop - Listen for notifications
    while let Some(notification) = listener.recv().await {
        match serde_json::from_str::<BlockNotification>(&notification) {
            Ok(block) => {
                display_block_notification(&block);
            },
            Err(err) => {
                error!("Failed to parse notification: {}", err);
                println!("{}: {}", "Invalid notification format".red(), notification);
            }
        }
    }
    
    Ok(())
}

/// Connect to the PostgreSQL database
async fn connect_to_database(database_url: &str) -> Result<PgPool> {
    // Create a connection pool
    let pool = PgPool::connect(database_url)
        .await?;
        
    Ok(pool)
}

/// Subscribe to block notifications
async fn subscribe_to_blocks(pool: &PgPool) -> Result<tokio::sync::mpsc::Receiver<String>> {
    // Create a channel to forward notifications
    let (tx, rx) = tokio::sync::mpsc::channel(100);
    
    // Create a listener
    let mut pg_listener = PgListener::connect_with(pool).await?;
    
    // Subscribe to the new_block notification channel
    pg_listener.listen("new_block").await?;
    
    // Start a background task to receive notifications
    tokio::spawn(async move {
        info!("Block notification listener started");
        
        loop {
            match pg_listener.recv().await {
                Ok(notification) => {
                    // Forward the notification payload to our channel
                    let payload = notification.payload().to_string();
                    if tx.send(payload).await.is_err() {
                        // The receiver has been dropped, exit
                        warn!("Notification receiver dropped, stopping listener");
                        break;
                    }
                },
                Err(err) => {
                    // Handle listener errors
                    error!("Error from PostgreSQL listener: {}", err);
                    
                    // Wait a moment before retrying
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
        
        info!("Block notification listener stopped");
    });
    
    Ok(rx)
}

/// Display a block notification in a nicely formatted way
fn display_block_notification(block: &BlockNotification) {
    // Convert block timestamp to readable format
    let timestamp = DateTime::<Utc>::from_timestamp(block.timestamp as i64, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "Invalid timestamp".to_string());
    
    // Print block information
    println!("\n{}", "▓".repeat(80).bright_blue());
    println!("{} {}", "⚡ NEW BLOCK DETECTED".bold().bright_green(), 
             chrono::Utc::now().format("[%H:%M:%S]").to_string().bright_black());
    println!("{}", "▓".repeat(80).bright_blue());
    
    println!("  {}: {}", "Block Number".yellow().bold(), block.number.to_string().cyan());
    println!("  {}: {}", "Hash".yellow().bold(), block.hash.cyan());
    println!("  {}: {}", "Timestamp".yellow().bold(), timestamp.cyan());
    println!("  {}: {}", "Transactions".yellow().bold(), 
             block.transaction_count.to_string().cyan().bold());
             
    println!("{}", "▓".repeat(80).bright_blue());
    println!();
}