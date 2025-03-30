use anyhow::{Context, Result};
use futures_util::{SinkExt, stream::StreamExt};
use tokio::select;
use tokio::sync::Mutex;
use tokio::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{error, debug, info, warn};
use url::Url;
use std::sync::Arc;
use sqlx::PgPool;

use crate::models::{Block, SubscriptionRequest, WebSocketParams, JsonRpcResponse, SubscriptionResponse};
use crate::db;
use std::collections::HashMap;

/// Test WebSocket connection with diagnostic information
pub async fn test_websocket_connection(websocket_url: &str) -> Result<()> {
    info!("Testing WebSocket connection to: {}", websocket_url);
    
    // Parse and normalize WebSocket URL (ensuring proper format)
    let mut url_str = websocket_url.trim().to_string();
    
    // Check if we need to add protocol if missing
    if !url_str.starts_with("ws://") && !url_str.starts_with("wss://") {
        // Default to secure connection
        url_str = format!("wss://{}", url_str);
        info!("Added missing protocol to URL: {}", url_str);
    }
    
    // Ensure path ends with /ws if needed
    if !url_str.contains("/ws") && !url_str.ends_with("/") {
        url_str = format!("{}/ws", url_str);
        info!("Added '/ws' to URL path: {}", url_str);
    } else if url_str.ends_with("/") && !url_str.ends_with("/ws/") {
        url_str = format!("{}ws", url_str);
        info!("Added 'ws' to URL path: {}", url_str);
    }
    
    // Parse the finalized URL
    let url = Url::parse(&url_str)
        .context("Failed to parse WebSocket URL")?;
    
    info!("Final test WebSocket URL: {}", url);
    
    // Try HTTP connection first to check if host is reachable
    let http_url = format!("http{}://{}{}",
                         if url.scheme() == "wss" { "s" } else { "" },
                         url.host_str().unwrap_or("unknown"),
                         if let Some(port) = url.port() { format!(":{}", port) } else { "".to_string() });
    
    info!("Testing HTTP connectivity to host: {}", http_url);
    
    // Try connecting to WebSocket
    info!("Attempting WebSocket handshake...");
    
    // Set a short timeout for connection test
    let connect_fut = connect_async(url);
    
    // Add timeout to connection attempt
    match tokio::time::timeout(Duration::from_secs(10), connect_fut).await {
        Ok(Ok((_, response))) => {
            info!("✅ WebSocket connection test successful!");
            info!("Response status: {}", response.status());
            info!("WebSocket connection is working correctly");
            Ok(())
        },
        Ok(Err(e)) => {
            error!("❌ WebSocket connection test failed: {}", e);
            Err(anyhow::anyhow!("WebSocket connection test failed: {}", e))
        },
        Err(_) => {
            error!("❌ WebSocket connection test timed out after 10 seconds");
            Err(anyhow::anyhow!("WebSocket connection test timed out"))
        }
    }
}

// Global buffer configuration constants
const MAX_BUFFER_SIZE: usize = 2000;  // Max shreds per block to buffer before writing
const BUFFER_TIME_SECS: i64 = 60;     // Max seconds to buffer before time-based writing

/// Process WebSocket connection
pub async fn process_websocket(
    websocket_url: &str,
    pool: &PgPool,
    running: Arc<Mutex<bool>>,
) -> Result<()> {
    // Initialize shred counter
    let shred_count = Arc::new(Mutex::new(0));
    
    // Track the timestamp of the last received shred for interval calculation
    let last_shred_time = Arc::new(Mutex::new(None::<chrono::DateTime<chrono::Utc>>));
    
    // Track blocks we're processing (with in-memory buffering)
    let active_blocks = Arc::new(Mutex::new(HashMap::<i64, Block>::new()));
    
    // NOTE: The primary persistence mechanism is now block-number-based:
    // When a shred from a new higher block is received, all previous blocks are persisted.
    // The buffer size and time settings defined as constants are secondary mechanisms.
    // Parse and normalize WebSocket URL (ensuring proper format)
    let mut url_str = websocket_url.trim().to_string();
    
    // Check if we need to add protocol if missing
    if !url_str.starts_with("ws://") && !url_str.starts_with("wss://") {
        // Default to secure connection
        url_str = format!("wss://{}", url_str);
        info!("Added missing protocol to URL: {}", url_str);
    }
    
    // Ensure path ends with /ws if needed
    if !url_str.contains("/ws") && !url_str.ends_with("/") {
        url_str = format!("{}/ws", url_str);
        info!("Added '/ws' to URL path: {}", url_str);
    } else if url_str.ends_with("/") && !url_str.ends_with("/ws/") {
        url_str = format!("{}ws", url_str);
        info!("Added 'ws' to URL path: {}", url_str);
    }
    
    // Parse the finalized URL
    let url = Url::parse(&url_str)
        .context("Failed to parse WebSocket URL")?;
    
    info!("Final WebSocket URL: {}", url);
    
    // Connect to WebSocket with retry logic and TLS configuration
    info!("Connecting to WebSocket at {}", url);
    
    // Connect to WebSocket with progress updates
    println!("Attempting WebSocket connection to {}", url);
    let connection_future = connect_async(url.clone());
    
    println!("Waiting for connection response...");
    let (ws_stream, response) = match connection_future.await {
        Ok(result) => {
            println!("WebSocket connection established!");
            result
        },
        Err(e) => {
            let error_message = format!("Failed to connect to WebSocket at {}: {}", url, e);
            println!("ERROR: {}", error_message);
            return Err(anyhow::anyhow!(error_message));
        }
    };
    
    // Print HTTP response status to help debug connection issues
    info!("WebSocket connected with status: {}", response.status());
    
    // Print any useful headers from the response for debugging
    if let Some(protocol) = response.headers().get("sec-websocket-protocol") {
        info!("WebSocket protocol: {:?}", protocol);
    }
    
    info!("WebSocket connection established successfully");
    
    // Split WebSocket stream into sender and receiver
    let (mut write, mut read) = ws_stream.split();
    
    // Send standard subscription request
    info!("Preparing to send subscription request");
    let subscribe_request = SubscriptionRequest::new_subscription();
    
    // Log the subscription request for debugging
    info!("Subscription request: {:?}", subscribe_request);
    
    let request_json = serde_json::to_string(&subscribe_request)
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
        Ok(Ok(_)) => info!("Subscription request sent successfully (standard format)"),
        Ok(Err(e)) => {
            error!("Failed to send standard subscription request: {}", e);
            return Err(e);
        },
        Err(_) => return Err(anyhow::anyhow!("Subscription request timed out after 10 seconds")),
    }
    
    // Wait a moment before trying alternate format
    tokio::time::sleep(Duration::from_secs(2)).await;
    
    // Try a second format (some RISE implementations expect eth_subscribe)
    let alternate_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "eth_subscribe",
        "params": ["newShreds"]
    });
    
    let alt_request_json = serde_json::to_string(&alternate_request).unwrap();
    info!("Sending alternate subscription request: {}", alt_request_json);
    
    // Send alternate subscription request with timeout
    let alt_send_future = async {
        match write.send(Message::Text(alt_request_json)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("Failed to send alternate subscription request: {}", e)),
        }
    };
    
    // Use timeout but don't fail if it doesn't work
    match tokio::time::timeout(Duration::from_secs(5), alt_send_future).await {
        Ok(Ok(_)) => info!("Alternate subscription request sent successfully"),
        Ok(Err(e)) => warn!("Failed to send alternate subscription request: {}", e),
        Err(_) => warn!("Alternate subscription request timed out"),
    }
    
    // Try a third format (some implementations expect shreds as a parameter)
    tokio::time::sleep(Duration::from_secs(2)).await;
    
    // Third attempt with 'shreds' as parameter
    let third_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "subscribe",
        "params": ["shreds"]
    });
    
    let third_request_json = serde_json::to_string(&third_request).unwrap();
    info!("Sending third subscription request format: {}", third_request_json);
    
    // Send third subscription format with timeout
    let third_send_future = async {
        match write.send(Message::Text(third_request_json)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("Failed to send third subscription request: {}", e)),
        }
    };
    
    // Use timeout but don't fail if it doesn't work
    match tokio::time::timeout(Duration::from_secs(5), third_send_future).await {
        Ok(Ok(_)) => info!("Third subscription request sent successfully"),
        Ok(Err(e)) => warn!("Failed to send third subscription request: {}", e),
        Err(_) => warn!("Third subscription request timed out"),
    }
    
    info!("Waiting for subscription confirmation...");
    
    // Create clones for use in the periodic tasks
    let status_counter = shred_count.clone();
    let blocks_tracker = active_blocks.clone();
    let pool_clone = pool.clone();
    let status_blocks_tracker = active_blocks.clone();
    let memory_blocks_tracker = active_blocks.clone();
    
    // Spawn a task to periodically report shred count status
    let status_task = tokio::spawn(async move {
        let mut last_count = 0;
        
        loop {
            // Wait 1 minute between status reports
            tokio::time::sleep(Duration::from_secs(60)).await;
            
            // Get current count
            let current_count = *status_counter.lock().await;
            let new_shreds = current_count - last_count;
            
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
                    "STATUS: Processed {} new shreds in the last minute (total: {}). Buffer: {} active blocks, {} total buffered shreds, {} max per block, oldest update: {}s ago", 
                    new_shreds, current_count,
                    buffer_stats.0, buffer_stats.1, buffer_stats.2, buffer_stats.3
                );
            } else {
                info!(
                    "STATUS: No new shreds in the last minute (total: {}). Buffer: {} active blocks, {} total buffered shreds", 
                    current_count, buffer_stats.0, buffer_stats.1
                );
            }
            
            // Update last count
            last_count = current_count;
        }
    });
    
    // Spawn a task to periodically check for blocks that need persistence (for edge cases)
    let blocks_task = tokio::spawn(async move {
        loop {
            // Check every 30 seconds for blocks that might be stuck (backup to the main approach)
            tokio::time::sleep(Duration::from_secs(30)).await;
            
            // Identify blocks for processing based on time since last update
            let blocks_to_process = {
                let mut blocks_map = blocks_tracker.lock().await;
                let mut to_process = Vec::new();
                let mut to_complete = Vec::new();
                
                // Only find blocks with no activity for extended period (3 minutes)
                let cutoff_time = chrono::Utc::now() - chrono::Duration::seconds(180);
                
                for (block_number, block) in blocks_map.iter() {
                    if let Some(last_time) = block.last_shred_timestamp {
                        if last_time < cutoff_time && !block.is_persisted {
                            // This block hasn't received new shreds in 3 minutes, consider it stale and complete
                            to_complete.push(*block_number);
                            to_process.push(block.clone());
                            info!("Block {} marked as stale with {} shreds (no activity for >3min)", 
                                 block_number, block.shred_count);
                        }
                    }
                }
                
                // Remove stale blocks from the active map
                for block_number in &to_complete {
                    blocks_map.remove(block_number);
                }
                
                to_process
            };
            
            // Persist any stale blocks (this is a fallback for blocks that might be missed)
            for mut block in blocks_to_process {
                match db::persist_block_with_shreds(&pool_clone, &mut block).await {
                    Ok(_) => {
                        info!("Persisted stale block {} with {} shreds", block.number, block.shred_count);
                    },
                    Err(e) => error!("Failed to persist stale block {}: {}", block.number, e),
                }
            }
            
            // Also check for any active blocks that need to be persisted due to buffer size or time
            let active_blocks_to_persist = {
                let mut blocks_map = blocks_tracker.lock().await;
                let mut to_persist = Vec::new();
                
                // Find current highest block number
                let mut highest_block = 0;
                for &block_number in blocks_map.keys() {
                    highest_block = highest_block.max(block_number);
                }
                
                // Clean up old persisted blocks (more than 5 blocks behind the latest)
                let old_blocks: Vec<i64> = blocks_map.keys()
                    .filter(|&&num| num < highest_block - 5 && 
                            blocks_map.get(&num).map_or(false, |b| b.is_persisted))
                    .copied()
                    .collect();
                
                for old_block in old_blocks {
                    blocks_map.remove(&old_block);
                    debug!("Removed old persisted block {} from memory (current highest: {})", 
                          old_block, highest_block);
                }
                
                // Find blocks that need persisting
                for (_, block) in blocks_map.iter() {
                    // Only buffer active blocks that aren't already persisted
                    if !block.is_persisted && block.should_persist(BUFFER_TIME_SECS, MAX_BUFFER_SIZE) {
                        to_persist.push(block.clone());
                    }
                }
                
                to_persist
            };
            
            // Persist active blocks that meet criteria
            for mut block in active_blocks_to_persist {
                match db::persist_block_with_shreds(&pool_clone, &mut block).await {
                    Ok(_) => {
                        // Update the persisted state in the map
                        let mut blocks_map = blocks_tracker.lock().await;
                        if let Some(tracked_block) = blocks_map.get_mut(&block.number) {
                            tracked_block.mark_persisted();
                            debug!("Persisted active block {} due to buffer criteria", block.number);
                        }
                    },
                    Err(e) => error!("Failed to persist active block {}: {}", block.number, e),
                }
            }
        }
    });
    
    // Process incoming messages
    while *running.lock().await {
        select! {
            message = read.next() => {
                match message {
                    Some(Ok(msg)) => {
                        if let Message::Text(text) = msg {
                            // Log every incoming message for debugging
                            debug!("Received WebSocket message: {}", text);
                            
                            match process_message(text, pool, shred_count.clone(), last_shred_time.clone(), active_blocks.clone()).await {
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
    
    // Spawn a memory usage report task
    let memory_task = tokio::spawn(async move {
        loop {
            // Report every 5 minutes
            tokio::time::sleep(Duration::from_secs(300)).await;
            
            // Calculate memory usage of buffered shreds
            let memory_stats = {
                let blocks = memory_blocks_tracker.lock().await;
                let mut total_blocks = 0;
                let mut total_buffered_shreds = 0;
                let mut total_buffered_txs = 0;
                let mut total_buffered_state_changes = 0;
                
                for (_, block) in blocks.iter() {
                    total_blocks += 1;
                    total_buffered_shreds += block.buffered_count();
                    
                    // Count transactions and state changes in all buffered shreds
                    for shred in &block.buffered_shreds {
                        total_buffered_txs += shred.transactions.len();
                        total_buffered_state_changes += shred.state_changes.len();
                    }
                }
                
                (total_blocks, total_buffered_shreds, total_buffered_txs, total_buffered_state_changes)
            };
            
            info!(
                "MEMORY: Tracking {} blocks with {} buffered shreds, {} transactions, {} state changes", 
                memory_stats.0, memory_stats.1, memory_stats.2, memory_stats.3
            );
        }
    });
    
    // Abort all background tasks
    status_task.abort();
    blocks_task.abort();
    memory_task.abort();
    
    // Flush all remaining buffered data before exiting
    info!("Flushing all buffered data before exiting...");
    
    let blocks_to_flush = {
        let blocks_map = active_blocks.lock().await;
        blocks_map.values()
            .filter(|block| !block.is_persisted && !block.buffered_shreds.is_empty())
            .cloned()
            .collect::<Vec<Block>>()
    };
    
    let total_blocks = blocks_to_flush.len();
    let mut total_shreds = 0;
    
    // Persist all remaining blocks with retries
    for mut block in blocks_to_flush {
        let block_shreds = block.buffered_count();
        total_shreds += block_shreds;
        
        // Only persist once - no retries
        match db::persist_block_with_shreds(pool, &mut block).await {
            Ok(_) => {
                info!("Flushed block {} with {} buffered shreds", block.number, block_shreds);
            },
            Err(e) => {
                error!("Failed to flush block {}: {}", block.number, e);
                error!("{} shreds may be lost on shutdown.", block_shreds);
            },
        }
    }
    
    info!("Finished flushing {} blocks with {} total shreds", total_blocks, total_shreds);
    
    Ok(())
}

/// Process incoming WebSocket message
async fn process_message(
    text: String, 
    pool: &PgPool, 
    shred_counter: Arc<Mutex<u64>>,
    last_shred_time: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    active_blocks: Arc<Mutex<HashMap<i64, Block>>>,
) -> Result<()> {
    // First try to parse as a generic JSON-RPC message to determine type
    let generic_response: JsonRpcResponse = match serde_json::from_str(&text) {
        Ok(response) => response,
        Err(e) => {
            return Err(anyhow::anyhow!("Failed to parse WebSocket message as JSON-RPC: {}", e));
        }
    };
    
    // Log message type details
    if generic_response.id.is_some() && generic_response.result.is_some() {
        info!("Received response message with ID: {:?}", generic_response.id);
        
        // This could be a subscription confirmation
        if let Ok(subscription_resp) = serde_json::from_str::<SubscriptionResponse>(&text) {
            info!("Subscription confirmed with ID: {}", subscription_resp.result);
            return Ok(());
        }
    }
    
    // Check if this is an error message
    if let Some(error) = generic_response.error {
        error!("Received JSON-RPC error: code={}, message={}", error.code, error.message);
        return Err(anyhow::anyhow!("JSON-RPC error: {}", error.message));
    }
    
    // Check if this is a notification (method with no id)
    if generic_response.method.is_some() && generic_response.id.is_none() {
        debug!("Received notification message: method={:?}", generic_response.method);
    }
    
    // Try to parse as a shred message
    if let Ok(ws_message) = serde_json::from_str::<WebSocketParams>(&text) {
        // Extract shred data
        let mut shred = ws_message.params.result;
        let current_time = chrono::Utc::now();
        shred.timestamp = Some(current_time);
        
        // Calculate shred interval from previous shred if available
        let mut last_time_lock = last_shred_time.lock().await;
        if let Some(last_time) = *last_time_lock {
            // Calculate time difference in milliseconds
            let interval_ms = (current_time - last_time).num_milliseconds();
            
            // Only set interval if positive (to handle out-of-order messages)
            if interval_ms > 0 {
                shred.shred_interval = Some(interval_ms);
                debug!("Shred interval: {} ms", interval_ms);
            }
        }
        
        // Update last shred timestamp for next interval calculation
        *last_time_lock = Some(current_time);
        // Release the lock
        drop(last_time_lock);
        
        debug!(
            "Received shred: block={}, idx={}, transactions={}, state_changes={}",
            shred.block_number,
            shred.shred_idx,
            shred.transactions.len(),
            shred.state_changes.len()
        );
        
        // Since we're just storing shreds in memory until persistence,
        // we don't need a temporary negative ID. Let's use the natural 
        // shred_idx directly as it's already guaranteed to be sequential and unique per block
        let shred_id = shred.shred_idx; // Use the natural shred index
        
        // Update or create block information
        {
            let mut blocks = active_blocks.lock().await;
            let timestamp = shred.timestamp.unwrap_or_else(chrono::Utc::now);
            
            // Check if we need to persist any previous blocks
            let current_block_number = shred.block_number;
            let mut blocks_to_persist = Vec::new();
            
            // Find all blocks with lower block numbers - they're now complete since we've moved to a new block
            for (block_number, block) in blocks.iter() {
                if *block_number < current_block_number && !block.is_persisted {
                    info!("Block {} is complete (received shred from block {})", *block_number, current_block_number);
                    blocks_to_persist.push(block.clone());
                }
            }
            
            // Get or create the block for the current shred
            let block = blocks.entry(current_block_number).or_insert_with(|| {
                info!("Started tracking new block {}", current_block_number);
                Block::new(current_block_number, timestamp)
            });
            
            // Update block with this shred (will buffer the shred)
            block.update_with_shred(shred_id, &shred, timestamp);
            
            // Log buffer stats periodically
            if block.shred_count % 10 == 0 {
                debug!(
                    "Block {} buffer: {} shreds ({:.1}% of max {})",
                    block.number,
                    block.buffered_count(),
                    block.buffered_count() as f32 * 100.0 / MAX_BUFFER_SIZE as f32,
                    MAX_BUFFER_SIZE
                );
            }
            
            // Release the lock before database operations
            drop(blocks);
            
            // Persist any completed blocks - only attempt once per block
            for mut completed_block in blocks_to_persist {
                info!("Persisting completed block {} with {} shreds", completed_block.number, completed_block.buffered_count());
                
                match db::persist_block_with_shreds(pool, &mut completed_block).await {
                    Ok(_) => {
                        // Update the original block to mark it as persisted
                        let mut blocks = active_blocks.lock().await;
                        if let Some(tracked_block) = blocks.get_mut(&completed_block.number) {
                            tracked_block.mark_persisted();
                            debug!("Marked block {} as persisted", completed_block.number);
                        }
                    },
                    Err(e) => {
                        error!("Failed to persist completed block {}: {}", completed_block.number, e);
                    },
                }
            }
            
            // Check if current block's buffer should be immediately persisted
            let should_persist_immediately = {
                let blocks = active_blocks.lock().await;
                if let Some(block) = blocks.get(&current_block_number) {
                    block.buffered_count() >= MAX_BUFFER_SIZE
                } else {
                    false
                }
            };
            
            if should_persist_immediately {
                let mut block_clone = {
                    let blocks = active_blocks.lock().await;
                    blocks.get(&current_block_number).cloned().unwrap()
                };
                
                info!(
                    "Buffer size limit reached for block {} - persisting now ({} shreds)",
                    block_clone.number, block_clone.buffered_count()
                );
                
                // Persist immediately - only attempt once
                match db::persist_block_with_shreds(pool, &mut block_clone).await {
                    Ok(_) => {
                        // Update the original block to mark it as persisted
                        let mut blocks = active_blocks.lock().await;
                        if let Some(tracked_block) = blocks.get_mut(&block_clone.number) {
                            tracked_block.mark_persisted();
                            info!("Successfully persisted block {}", block_clone.number);
                        }
                    },
                    Err(e) => {
                        error!("Failed to persist block {}: {}", block_clone.number, e);
                    },
                }
            }
        }
        
        // Increment shred counter
        let mut counter = shred_counter.lock().await;
        *counter += 1;
        
        // Log shred information with updated count
        let interval_info = if let Some(interval) = shred.shred_interval {
            format!(", interval={}ms", interval)
        } else {
            "".to_string()
        };
        
        debug!(
            "Successfully saved shred #{}: block={}, idx={}, tx_count={}, state_changes={}{}",
            *counter,
            shred.block_number,
            shred.shred_idx,
            shred.transactions.len(),
            shred.state_changes.len(),
            interval_info
        );
        
        return Ok(());
    }
    
    // If we got here, we couldn't process the message as a known type
    warn!("Received unrecognized message format: {}", text);
    Ok(())
}