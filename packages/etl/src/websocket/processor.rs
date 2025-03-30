use anyhow::{Context, Result};
use futures_util::{SinkExt, stream::StreamExt};
use tokio::select;
use tokio::sync::Mutex;
use tokio::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{error, debug, info, warn};
use std::sync::Arc;
use sqlx::PgPool;

use crate::models::Block;
use crate::websocket::connection::normalize_websocket_url;
use crate::websocket::message_handler::process_message;
use crate::websocket::block_manager::BlockManager;

/// Process WebSocket connection
pub async fn process_websocket(
    websocket_url: &str,
    pool: &PgPool,
    running: Arc<Mutex<bool>>,
) -> Result<()> {
    // Initialize block manager
    let block_manager = BlockManager::new(pool.clone());
    
    // Initialize shred counter
    let shred_count = Arc::new(Mutex::new(0));
    
    // Track the timestamp of the last received shred for interval calculation
    let last_shred_time = Arc::new(Mutex::new(None::<chrono::DateTime<chrono::Utc>>));
    
    // Parse and normalize WebSocket URL
    let url = normalize_websocket_url(websocket_url)?;
    
    info!("Final WebSocket URL: {}", url);
    
    // Connect to WebSocket with progress updates
    info!("Connecting to WebSocket at {}", url);
    let (ws_stream, response) = connect_async(url.clone()).await
        .context("Failed to connect to WebSocket")?;
    
    // Print HTTP response status to help debug connection issues
    info!("WebSocket connected with status: {}", response.status());
    
    // Print any useful headers from the response for debugging
    if let Some(protocol) = response.headers().get("sec-websocket-protocol") {
        info!("WebSocket protocol: {:?}", protocol);
    }
    
    info!("WebSocket connection established successfully");
    
    // Split WebSocket stream into sender and receiver
    let (mut write, mut read) = ws_stream.split();
    
    // Send subscriptions
    await_subscription(&mut write).await?;
    
    // Create clones for use in the periodic tasks
    let status_counter = shred_count.clone();
    let status_blocks_tracker = block_manager.get_active_blocks();
    let duplicate_counter = block_manager.get_duplicate_count();
    let blocks_dropped_counter = block_manager.get_blocks_dropped_count();
    let pool_clone = pool.clone();
    
    // Spawn a task to periodically report status
    let status_task = spawn_status_reporter(status_counter, status_blocks_tracker, duplicate_counter, blocks_dropped_counter);
    
    // Spawn a task to periodically check blocks
    let blocks_task = spawn_block_checker(block_manager.clone(), pool_clone.clone());
    
    // Process incoming messages
    while *running.lock().await {
        select! {
            message = read.next() => {
                match message {
                    Some(Ok(msg)) => {
                        if let Message::Text(text) = msg {
                            // Log every incoming message for debugging
                            debug!("Received WebSocket message: {}", text);
                            
                            match process_message(text, &block_manager, shred_count.clone(), last_shred_time.clone()).await {
                                Ok(_) => {},
                                Err(e) => warn!("Error processing message: {}", e),
                            }
                        } else if let Message::Ping(data) = msg {
                            // Respond to ping with pong
                            info!("Received ping, sending pong");
                            if let Err(e) = write.send(Message::Pong(data)).await {
                                error!("Failed to send pong: {}", e);
                            }
                        } else {
                            // Log other message types
                            info!("Received non-text message: {:?}", msg);
                        }
                    },
                    Some(Err(e)) => {
                        error!("WebSocket error: {}", e);
                        break;
                    },
                    None => {
                        info!("WebSocket connection closed");
                        break;
                    },
                }
            },
            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                // Ping to keep the connection alive
                info!("Sending ping to keep connection alive");
                if let Err(e) = write.send(Message::Ping(vec![])).await {
                    error!("Failed to send ping: {}", e);
                    break;
                }
                
                // Also report current count
                let current_count = *shred_count.lock().await;
                info!("Total shreds processed so far: {}", current_count);
            }
        }
    }
    
    // Abort all background tasks
    status_task.abort();
    blocks_task.abort();
    
    // Flush all remaining buffered data before exiting
    info!("Flushing all buffered data before exiting...");
    
    let blocks_to_flush = block_manager.get_blocks_to_flush().await;
    
    let total_blocks = blocks_to_flush.len();
    let mut total_shreds = 0;
    
    // Queue all remaining blocks for persistence
    for block in blocks_to_flush {
        let block_shreds = block.buffered_count();
        total_shreds += block_shreds;
        
        // Send to the persistence worker
        if let Err(e) = block_manager.persist_block(block).await {
            error!("Failed to queue block for persistence during shutdown: {}", e);
        }
    }
    
    info!("Queued {} blocks with {} total shreds for persistence", total_blocks, total_shreds);
    
    // Wait a bit to allow the persistence worker to process the queue
    if total_blocks > 0 {
        let wait_time = std::cmp::min(total_blocks as u64 * 2, 30); // Max 30 seconds wait
        info!("Waiting {} seconds for persistence to complete...", wait_time);
        tokio::time::sleep(tokio::time::Duration::from_secs(wait_time)).await;
    }
    
    // Shut down the persistence worker
    if let Err(e) = block_manager.shutdown().await {
        error!("Error shutting down persistence worker: {}", e);
    } else {
        info!("Persistence worker shutdown complete");
    }
    
    Ok(())
}

/// Spawn a task to periodically report status
fn spawn_status_reporter(
    status_counter: Arc<Mutex<u64>>,
    status_blocks_tracker: Arc<Mutex<std::collections::HashMap<i64, Block>>>,
    duplicate_counter: Arc<Mutex<u64>>,
    blocks_dropped_counter: Arc<Mutex<u64>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut last_count = 0;
        let mut last_duplicate_count = 0;
        let mut last_blocks_dropped_count = 0;
        
        loop {
            // Wait 1 minute between status reports
            tokio::time::sleep(Duration::from_secs(60)).await;
            
            // Get current count of shreds, duplicates and blocks dropped
            let current_count = *status_counter.lock().await;
            let current_duplicates = *duplicate_counter.lock().await;
            let current_blocks_dropped = *blocks_dropped_counter.lock().await;
            let new_shreds = current_count - last_count;
            let new_duplicates = current_duplicates - last_duplicate_count;
            let new_blocks_dropped = current_blocks_dropped - last_blocks_dropped_count;
            
            // Get buffer statistics
            let buffer_stats = {
                let blocks = status_blocks_tracker.lock().await;
                let active_blocks = blocks.len();
                let mut total_buffered = 0;
                let mut max_buffered = 0;
                let mut oldest_update_secs = 0;
                
                for (_, block) in blocks.iter() {
                    let buffered = block.buffered_count();
                    total_buffered += buffered;
                    max_buffered = max_buffered.max(buffered);
                    
                    let update_age = (chrono::Utc::now() - block.last_update_time).num_seconds();
                    oldest_update_secs = oldest_update_secs.max(update_age);
                }
                
                (active_blocks, total_buffered, max_buffered, oldest_update_secs)
            };
            
            // Report status
            if new_shreds > 0 {
                info!(
                    "STATUS: Processed {} new shreds in the last minute (total: {}). Duplicates: {} new, {} total. Blocks dropped: {} new, {} total. Buffer: {} active blocks, {} total buffered shreds, {} max per block, oldest update: {}s ago", 
                    new_shreds, current_count,
                    new_duplicates, current_duplicates,
                    new_blocks_dropped, current_blocks_dropped,
                    buffer_stats.0, buffer_stats.1, buffer_stats.2, buffer_stats.3
                );
            } else {
                info!(
                    "STATUS: No new shreds in the last minute (total: {}). Duplicates total: {}. Blocks dropped total: {}. Buffer: {} active blocks, {} total buffered shreds", 
                    current_count, current_duplicates, current_blocks_dropped, buffer_stats.0, buffer_stats.1
                );
            }
            
            // Update last counts
            last_count = current_count;
            last_duplicate_count = current_duplicates;
            last_blocks_dropped_count = current_blocks_dropped;
        }
    })
}

/// Spawn a task to periodically check blocks
fn spawn_block_checker(
    block_manager: BlockManager,
    _pool: PgPool,
) -> tokio::task::JoinHandle<()> {
    
    tokio::spawn(async move {
        loop {
            // Check every 30 seconds for blocks that might need processing
            tokio::time::sleep(Duration::from_secs(30)).await;
            
            // Process stale blocks
            let stale_blocks = block_manager.find_stale_blocks().await;
            for block in stale_blocks {
                let _ = block_manager.persist_block(block).await;
            }
            
            // Process blocks that need persisting due to buffer criteria
            let buffer_blocks = block_manager.find_blocks_by_buffer_criteria().await;
            for block in buffer_blocks {
                let _ = block_manager.persist_block(block).await;
            }
        }
    })
}

/// Send subscription request to the WebSocket server
async fn await_subscription(write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
    // Send the correct subscription request
    info!("Preparing to send subscription request");
    
    // Create subscription request with the correct format
    let subscription_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "rise_subscribe",
        "params": ["shreds"]
    });
    
    let request_json = serde_json::to_string(&subscription_request)
        .context("Failed to serialize subscription request")?;
    
    info!("Sending subscription request: {}", request_json);
    
    // Send subscription request with timeout
    let send_future = async {
        match write.send(Message::Text(request_json.clone())).await {
            Ok(_) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("Failed to send subscription request: {}", e)),
        }
    };
    
    // Use timeout
    match tokio::time::timeout(Duration::from_secs(10), send_future).await {
        Ok(Ok(_)) => info!("Subscription request sent successfully"),
        Ok(Err(e)) => {
            error!("Failed to send subscription request: {}", e);
            return Err(e);
        },
        Err(_) => return Err(anyhow::anyhow!("Subscription request timed out after 10 seconds")),
    }
    
    info!("Waiting for subscription confirmation...");
    
    Ok(())
}