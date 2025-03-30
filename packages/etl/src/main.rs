mod db;
mod models;
mod websocket;

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use tracing::{error, info, warn};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::sleep;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging with environment variable control
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    
    // Add direct console output to make sure program is starting
    println!("==================================================");
    println!("RISE Shred Explorer ETL starting...");
    println!("If you don't see any logs below this line, check your RUST_LOG setting");
    println!("==================================================");
    
    // Load environment variables with error checking
    match dotenvy::dotenv() {
        Ok(path) => println!("Loaded environment from {}", path.display()),
        Err(e) => println!("Warning: Failed to load .env file: {}", e),
    }
    
    // Set a default log level if none was provided
    if std::env::var("RUST_LOG").is_err() {
        println!("Setting default RUST_LOG=info (no RUST_LOG found in environment)");
        std::env::set_var("RUST_LOG", "info");
    } else {
        println!("Using RUST_LOG={}", std::env::var("RUST_LOG").unwrap_or_default());
    }
    
    // Get and validate configuration from environment variables
    
    // Check DATABASE_URL
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => {
            println!("Found DATABASE_URL: {}", url);
            url
        },
        Err(_) => {
            let error = "DATABASE_URL environment variable not set. Create a .env file with DATABASE_URL=postgres://...";
            println!("ERROR: {}", error);
            return Err(anyhow::anyhow!(error));
        }
    };
    
    // Check WEBSOCKET_URL
    let websocket_url = match std::env::var("WEBSOCKET_URL") {
        Ok(url) => {
            println!("Found WEBSOCKET_URL: {}", url);
            url
        },
        Err(_) => {
            let error = "WEBSOCKET_URL environment variable not set. Create a .env file with WEBSOCKET_URL=wss://...";
            println!("ERROR: {}", error);
            return Err(anyhow::anyhow!(error));
        }
    };
    
    // Validate WebSocket URL and print connection details
    validate_websocket_url(&websocket_url)?;
    
    // Test WebSocket connection
    match websocket::test_websocket_connection(&websocket_url).await {
        Ok(_) => info!("WebSocket connection test successful"),
        Err(e) => warn!("WebSocket connection test failed: {}. Will try to connect anyway.", e),
    };
    
    // Initialize database connection pool with detailed error handling
    info!("Connecting to database...");
    println!("Attempting database connection to PostgreSQL...");
    
    let db_pool = match PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
    {
        Ok(pool) => {
            println!("Database connection established successfully!");
            pool
        },
        Err(e) => {
            let error_message = format!("Failed to connect to database: {}", e);
            println!("DATABASE ERROR: {}", error_message);
            println!("Check that your PostgreSQL server is running and the DATABASE_URL is correct.");
            return Err(anyhow::anyhow!(error_message));
        }
    };
    
    // Ensure database schema is created
    db::setup_database(&db_pool).await?;
    info!("Database setup complete");
    
    // Shared state for websocket reconnection
    let running = Arc::new(Mutex::new(true));
    let r = running.clone();

    // Handle Ctrl+C for graceful shutdown
    tokio::spawn(async move {
        if let Ok(_) = tokio::signal::ctrl_c().await {
            info!("Shutdown signal received");
            let mut lock = r.lock().await;
            *lock = false;
        }
    });
    
    // Main processing loop
    while *running.lock().await {
        match websocket::process_websocket(&websocket_url, &db_pool, running.clone()).await {
            Ok(_) => {
                info!("WebSocket connection closed gracefully");
            }
            Err(e) => {
                // Enhanced error reporting with detailed message
                let error_message = format!("{}", e);
                if error_message.contains("connection refused") {
                    error!("WebSocket connection refused. Server might be down or firewall is blocking the connection.");
                } else if error_message.contains("timed out") {
                    error!("WebSocket connection timed out. Server might be slow or unreachable.");
                } else if error_message.contains("name resolution") {
                    error!("WebSocket hostname could not be resolved. Check if the hostname is correct.");
                } else if error_message.contains("certificate") || error_message.contains("TLS") {
                    error!("WebSocket TLS/certificate error. Check if the server has a valid certificate.");
                } else {
                    error!("WebSocket error: {}", e);
                }
                // Log the entire error chain for debugging
                let mut source = e.source();
                let mut depth = 0;
                while let Some(err) = source {
                    error!("  Caused by ({}): {}", depth, err);
                    source = err.source();
                    depth += 1;
                }
            }
        }
        
        // Only attempt to reconnect if we're still supposed to be running
        if *running.lock().await {
            info!("Reconnecting in 3 seconds...");
            sleep(Duration::from_secs(3)).await;
        }
    }
    
    info!("ETL process terminated");
    Ok(())
}

/// Validate WebSocket URL and print connection details
fn validate_websocket_url(url_str: &str) -> Result<()> {
    let url = url::Url::parse(url_str)
        .context("Failed to parse WebSocket URL")?;
    
    // Check scheme
    match url.scheme() {
        "ws" => info!("Using insecure WebSocket connection (ws://)"),
        "wss" => info!("Using secure WebSocket connection (wss://)"),
        scheme => return Err(anyhow::anyhow!("Invalid WebSocket scheme: {}, must be ws:// or wss://", scheme)),
    }
    
    // Print host and port
    let host = url.host_str().context("WebSocket URL is missing host")?;
    let port = url.port().unwrap_or(if url.scheme() == "wss" { 443 } else { 80 });
    
    info!("WebSocket host: {}", host);
    info!("WebSocket port: {}", port);
    
    // Print path
    info!("WebSocket path: {}", url.path());
    
    // Check if the URL looks valid
    if !host.contains(".") && host != "localhost" {
        warn!("WebSocket host '{}' doesn't look like a valid hostname or IP address", host);
    }
    
    Ok(())
}