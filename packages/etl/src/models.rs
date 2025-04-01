use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::debug;

// Shred data structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionSignature {
    pub r: String,
    pub s: String,
    #[serde(rename = "yParity")]
    pub y_parity: String,
    pub v: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionDetails {
    #[serde(rename = "type")]
    pub tx_type: String,
    #[serde(rename = "chainId")]
    pub chain_id: String,
    pub nonce: String,
    pub gas: String,
    #[serde(rename = "maxFeePerGas")]
    pub max_fee_per_gas: String,
    #[serde(rename = "maxPriorityFeePerGas")]
    pub max_priority_fee_per_gas: String,
    pub to: String,
    pub value: String,
    #[serde(rename = "accessList")]
    pub access_list: Vec<serde_json::Value>,
    pub input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionData {
    pub signature: TransactionSignature,
    pub transaction: TransactionDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TransactionReceipt {
    Eip1559 {
        status: String,
        #[serde(rename = "cumulativeGasUsed")]
        cumulative_gas_used: String,
        logs: Vec<serde_json::Value>,
    },
    // Can add other receipt types here if needed
    Other(serde_json::Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub transaction: TransactionData,
    pub receipt: TransactionReceipt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateChange {
    pub nonce: i64,
    pub balance: String,
    pub storage: serde_json::Value,
    #[serde(rename = "new_code")]
    pub new_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shred {
    pub block_number: i64,
    pub shred_idx: i64,
    pub transactions: Vec<Transaction>,
    pub state_changes: HashMap<String, StateChange>,
    #[serde(skip)]
    pub timestamp: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip)]
    pub shred_interval: Option<i64>,  // Time interval in milliseconds between this shred and the previous one
}

/// Block information derived from shreds with buffered data
#[derive(Debug, Clone)]
pub struct Block {
    pub number: i64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub transaction_count: i32,
    pub shred_count: i32,
    pub state_change_count: i32,
    pub first_shred_id: Option<i64>,
    pub last_shred_id: Option<i64>,
    pub block_time: Option<i64>,  // Time in ms from first to last shred
    pub first_shred_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub last_shred_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub avg_tps: Option<f64>,     // Average transactions per second
    pub avg_shred_interval: Option<f64>, // Average time between shreds in milliseconds
    
    // Buffered data to minimize database writes
    pub buffered_shreds: Vec<Shred>,
    pub is_persisted: bool,
    pub last_update_time: chrono::DateTime<chrono::Utc>,
}

impl Block {
    /// Create a new block with just the block number
    pub fn new(number: i64, timestamp: chrono::DateTime<chrono::Utc>) -> Self {
        Block {
            number,
            timestamp,
            transaction_count: 0,
            shred_count: 0,
            state_change_count: 0,
            first_shred_id: None,
            last_shred_id: None,
            block_time: None,
            first_shred_timestamp: None,
            last_shred_timestamp: None,
            avg_tps: None,
            avg_shred_interval: None,
            
            // Initialize buffer storage
            buffered_shreds: Vec::new(),
            is_persisted: false,
            last_update_time: timestamp,
        }
    }
    
    /// Check if the block should be persisted based on criteria
    pub fn should_persist(&self, max_buffer_time_secs: i64, max_buffer_size: usize) -> bool {
        if self.is_persisted {
            return false; // Already persisted
        }
        
        // Persist if we've accumulated enough shreds
        if self.buffered_shreds.len() >= max_buffer_size {
            return true;
        }
        
        // Persist if buffer time exceeded
        let time_since_last_update = (chrono::Utc::now() - self.last_update_time).num_seconds();
        if time_since_last_update >= max_buffer_time_secs {
            return true;
        }
        
        false
    }
    
    /// Update block with shred data
    pub fn update_with_shred(&mut self, shred_id: i64, shred: &Shred, timestamp: chrono::DateTime<chrono::Utc>) {
        // Update counts
        self.transaction_count += shred.transactions.len() as i32;
        self.shred_count += 1;
        self.state_change_count += shred.state_changes.len() as i32;
        
        // Track first and last shred indexes - not database IDs
        // We'll temporarily use the natural shred_idx for tracking in memory
        // The database will assign real IDs when persisting, which we'll update in persist_block_with_shreds
        
        // Track first shred received (smallest shred_idx)
        if self.first_shred_id.is_none() || shred_id < self.first_shred_id.unwrap_or(i64::MAX) {
            self.first_shred_id = Some(shred_id);
            self.first_shred_timestamp = Some(timestamp);
            debug!("Updated first_shred_id={} for block {}", shred_id, self.number);
        }
        
        // Track last shred received (largest shred_idx)
        if self.last_shred_id.is_none() || shred_id > self.last_shred_id.unwrap_or(i64::MIN) {
            self.last_shred_id = Some(shred_id);
            self.last_shred_timestamp = Some(timestamp);
            debug!("Updated last_shred_id={} for block {}", shred_id, self.number);
        }
        
        // Calculate block time if we have first and last timestamps
        if let (Some(first), Some(last)) = (self.first_shred_timestamp, self.last_shred_timestamp) {
            let block_time_ms = (last - first).num_milliseconds();
            self.block_time = Some(block_time_ms);
            
            // Calculate average TPS (Transactions Per Second)
            if block_time_ms > 0 && self.transaction_count > 0 {
                // Convert block_time from ms to seconds for TPS calculation
                let block_time_secs = block_time_ms as f64 / 1000.0;
                self.avg_tps = Some(self.transaction_count as f64 / block_time_secs);
            }
            
            // Calculate average shred interval
            if self.shred_count > 1 {  // Need at least 2 shreds to have an interval
                self.avg_shred_interval = Some(block_time_ms as f64 / (self.shred_count - 1) as f64);
            }
        }
        
        // Buffer this shred for later batch processing
        self.buffered_shreds.push(shred.clone());
        
        // Update the last update time
        self.last_update_time = chrono::Utc::now();
        
        // Mark the block as no longer persisted (changes need to be saved)
        self.is_persisted = false;
    }
    
    /// Get the count of buffered shreds
    pub fn buffered_count(&self) -> usize {
        self.buffered_shreds.len()
    }
    
    /// Mark block as persisted after writing to database
    pub fn mark_persisted(&mut self) {
        self.is_persisted = true;
        // Clear the buffer to free memory
        self.buffered_shreds.clear();
    }
}

// WebSocket message structures
#[derive(Debug, Serialize, Deserialize)]
pub struct WebSocketResult {
    pub result: Shred,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSocketParams {
    pub params: WebSocketResult,
}

// Response to subscription request
#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionResponse {
    pub result: String,
    pub id: i64,
    pub jsonrpc: String,
}

// Generic JSON-RPC response
#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub jsonrpc: Option<String>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

// Subscription request is now handled directly in the processor
// with the correct format using serde_json::json!()