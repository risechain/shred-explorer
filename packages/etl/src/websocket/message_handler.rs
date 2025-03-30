use std::sync::Arc;
use tokio::sync::Mutex;
use anyhow::{anyhow, Result};
use tracing::{debug, info};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::models::{JsonRpcResponse, SubscriptionResponse, WebSocketParams};
use crate::websocket::block_manager::BlockManager;

/// Process incoming WebSocket message
pub async fn process_message(
    text: String, 
    block_manager: &BlockManager,
    shred_counter: Arc<Mutex<u64>>,
    last_shred_time: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
) -> Result<()> {
    // First try to parse as a generic JSON-RPC message to determine type
    let generic_response: JsonRpcResponse = match serde_json::from_str(&text) {
        Ok(response) => response,
        Err(e) => {
            return Err(anyhow!("Failed to parse WebSocket message as JSON-RPC: {}", e));
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
        return Err(anyhow!("JSON-RPC error: {}", error.message));
    }
    
    // Check if this is a notification (method with no id)
    if generic_response.method.is_some() && generic_response.id.is_none() {
        debug!("Received notification message: method={:?}", generic_response.method);
    }
    
    // Try to parse as a shred message
    if let Ok(ws_message) = serde_json::from_str::<WebSocketParams>(&text) {
        // Extract shred data
        let mut shred = ws_message.params.result;
        
        // For debugging purposes, log the shred index and block number
        // if shred.shred_idx == 0 {
        //     info!("RAW SHRED 0 for block {}: {}", shred.block_number, text);
        // }
        
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
          
        // Calculate a hash of the message string
        let msg_hash = {
            let mut hasher = DefaultHasher::new();
            text.hash(&mut hasher);
            hasher.finish()
        };
        
        debug!(
            "Received shred: block={}, idx={}, transactions={}, state_changes={}, msg_hash=0x{:x}",
            shred.block_number,
            shred.shred_idx,
            shred.transactions.len(),
            shred.state_changes.len(),
            msg_hash
        );
        
        // Use the natural shred index directly as it's guaranteed to be sequential and unique per block
        let shred_id = shred.shred_idx;
        let current_block_number = shred.block_number;
        
        // Process the shred with the block manager
        let blocks_to_persist = block_manager.add_shred(&shred, shred_id, current_time).await;
        
        // Persist any completed blocks
        for block in blocks_to_persist {
            // Using let _ to ignore the result since we already handle errors inside the method
            let _ = block_manager.persist_block(block).await;
        }
        
        // Check if current block should be persisted immediately due to buffer limit
        if let Some(block) = block_manager.check_buffer_limit(current_block_number).await {
            info!(
                "Buffer size limit reached for block {} - persisting now ({} shreds)",
                block.number, block.buffered_count()
            );
            
            // Using let _ to ignore the result since we already handle errors inside the method
            let _ = block_manager.persist_block(block).await;
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
            "Successfully processed shred #{}: block={}, idx={}, tx_count={}, state_changes={}{}, msg_hash=0x{:x}",
            *counter,
            shred.block_number,
            shred.shred_idx,
            shred.transactions.len(),
            shred.state_changes.len(),
            interval_info,
            msg_hash
        );
        
        return Ok(());
    }
    
    // If we got here, we couldn't process the message as a known type
    info!("Received unrecognized message format: {}", text);
    Ok(())
}