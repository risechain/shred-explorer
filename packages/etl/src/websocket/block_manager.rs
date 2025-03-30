use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use anyhow::Result;

use crate::models::{Block, Shred};
use crate::db;

// Global buffer configuration constants
pub const MAX_BUFFER_SIZE: usize = 1000;  // Max shreds per block to buffer before writing
pub const BUFFER_TIME_SECS: i64 = 60;     // Max seconds to buffer before time-based writing

/// Message type for the persistence worker
pub enum PersistenceMessage {
    PersistBlock(Block),
    Shutdown,
}

/// Block manager handles tracking, updating, and persisting blocks
#[derive(Clone)]
pub struct BlockManager {
    pool: PgPool,
    active_blocks: Arc<Mutex<HashMap<i64, Block>>>,
    persist_sender: mpsc::Sender<PersistenceMessage>,
    duplicate_count: Arc<Mutex<u64>>,
    blocks_dropped_count: Arc<Mutex<u64>>,
}

impl BlockManager {
    /// Create a new block manager with a background persistence worker
    pub fn new(pool: PgPool) -> Self {
        // Create a channel for sending persistence messages
        let (persist_sender, persist_receiver) = mpsc::channel::<PersistenceMessage>(100);
        
        // Clone the pool for the worker
        let worker_pool = pool.clone();
        
        // Start the persistence worker
        tokio::spawn(async move {
            Self::persistence_worker(worker_pool, persist_receiver).await;
        });
        
        Self {
            pool,
            active_blocks: Arc::new(Mutex::new(HashMap::new())),
            persist_sender,
            duplicate_count: Arc::new(Mutex::new(0)),
            blocks_dropped_count: Arc::new(Mutex::new(0)),
        }
    }
    
    /// Background worker that handles block persistence asynchronously
    async fn persistence_worker(pool: PgPool, mut receiver: mpsc::Receiver<PersistenceMessage>) {
        info!("Block persistence worker started");
        
        while let Some(message) = receiver.recv().await {
            match message {
                PersistenceMessage::PersistBlock(mut block) => {
                    let block_number = block.number;
                    let buffered_count = block.buffered_count();
                    
                    info!("Persistence worker: persisting block {} with {} shreds", block_number, buffered_count);
                    
                    match db::persist_block_with_shreds(&pool, &mut block).await {
                        Ok(_) => {
                            info!("Persistence worker: successfully persisted block {} with {} shreds", 
                                 block_number, buffered_count);
                        },
                        Err(e) => {
                            error!("Persistence worker: failed to persist block {}: {}", block_number, e);
                        }
                    }
                },
                PersistenceMessage::Shutdown => {
                    info!("Persistence worker received shutdown signal");
                    break;
                }
            }
        }
        
        info!("Block persistence worker shutdown");
    }
    
    /// Get a reference to the active blocks
    pub fn get_active_blocks(&self) -> Arc<Mutex<HashMap<i64, Block>>> {
        self.active_blocks.clone()
    }
    
    /// Get the current duplicate shred count
    pub fn get_duplicate_count(&self) -> Arc<Mutex<u64>> {
        self.duplicate_count.clone()
    }
    
    /// Get the count of blocks dropped due to duplicates
    pub fn get_blocks_dropped_count(&self) -> Arc<Mutex<u64>> {
        self.blocks_dropped_count.clone()
    }
    
    // The drop_and_restart_block functionality has been integrated directly into add_shred
    // to prevent race conditions
    
    /// Add a shred to a block, creating the block if needed
    pub async fn add_shred(&self, shred: &Shred, shred_id: i64, timestamp: chrono::DateTime<chrono::Utc>) -> Vec<Block> {
        let mut blocks_to_persist = Vec::new();
        let current_block_number = shred.block_number;
        let current_shred_idx = shred.shred_idx;
        
        // Acquire the active_blocks lock once and handle all operations in a single critical section
        let mut blocks = self.active_blocks.lock().await;
        
        // Step 1: Check for duplicate shreds
        let is_duplicate = if let Some(existing_block) = blocks.get(&current_block_number) {
            // Check if any of the buffered shreds has the same index as the current shred
            existing_block.buffered_shreds.iter()
                .any(|s| s.shred_idx == current_shred_idx)
        } else {
            false
        };
        
        // Step 2: Handle duplicate if found
        if is_duplicate {
            // Release the blocks lock while we update the counter
            drop(blocks);
            
            // Increment duplicate counter
            let total_duplicates = {
                let mut count = self.duplicate_count.lock().await;
                *count += 1;
                *count
            };
            
            // Log the duplicate
            warn!("DUPLICATE SHRED DETECTED: Block: {}, Shred index: {}, Total duplicates: {}", 
                  current_block_number, current_shred_idx, total_duplicates);
                
            // Increment blocks dropped counter
            let total_dropped = {
                let mut count = self.blocks_dropped_count.lock().await;
                *count += 1;
                *count
            };
            
            warn!("Block {} will be dropped and restarted (total blocks dropped: {})", 
                 current_block_number, total_dropped);
            
            // Re-acquire the blocks lock to reset the block
            blocks = self.active_blocks.lock().await;
            
            // First, log existing block details for debugging
            if let Some(existing_block) = blocks.get(&current_block_number) {
                info!(
                    "Dropping block {}: had {} shreds, {} transactions, {} state changes", 
                    current_block_number, 
                    existing_block.shred_count,
                    existing_block.transaction_count,
                    existing_block.state_change_count
                );
            }
            
            // Remove the existing block
            blocks.remove(&current_block_number);
            
            // Create a new block
            let shred_timestamp = shred.timestamp.unwrap_or_else(chrono::Utc::now);
            let mut new_block = Block::new(current_block_number, shred_timestamp);
            
            // Add the current shred to the new block
            new_block.update_with_shred(shred_id, shred, timestamp);
            
            info!(
                "Restarted block {} with initial shred {}, tx_count={}, state_changes={}", 
                current_block_number, 
                shred_id,
                shred.transactions.len(),
                shred.state_changes.len()
            );
            
            // Insert the new block
            blocks.insert(current_block_number, new_block);
            
            // Return empty list - no blocks to persist
            return Vec::new();
        }
        
        // Step 3: Regular processing (no duplicate)
        let shred_timestamp = shred.timestamp.unwrap_or_else(chrono::Utc::now);
        
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
            Block::new(current_block_number, shred_timestamp)
        });
        
        // Update block with this shred (will buffer the shred)
        block.update_with_shred(shred_id, shred, timestamp);
        
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
        
        blocks_to_persist
    }
    
    /// Check if a block has reached its buffer limit and should be persisted immediately
    pub async fn check_buffer_limit(&self, block_number: i64) -> Option<Block> {
        let should_persist_immediately = {
            let blocks = self.active_blocks.lock().await;
            if let Some(block) = blocks.get(&block_number) {
                block.buffered_count() >= MAX_BUFFER_SIZE
            } else {
                false
            }
        };
        
        if should_persist_immediately {
            let blocks = self.active_blocks.lock().await;
            blocks.get(&block_number).cloned()
        } else {
            None
        }
    }
    
    /// Queue a block for asynchronous persistence
    pub async fn persist_block(&self, block: Block) -> Result<()> {
        let block_number = block.number;
        let buffered_count = block.buffered_count();
        
        info!(
            "Queueing block {} with {} shreds for persistence",
            block_number, buffered_count
        );
        
        // Mark the block as queued for persistence to avoid duplicate persistence
        {
            let mut blocks = self.active_blocks.lock().await;
            if let Some(tracked_block) = blocks.get_mut(&block_number) {
                // Only mark as being processed - the worker will handle the actual persistence
                tracked_block.is_persisted = true;
                debug!("Marked block {} as queued for persistence", block_number);
            }
        }
        
        // Send the block to the persistence worker
        match self.persist_sender.send(PersistenceMessage::PersistBlock(block)).await {
            Ok(_) => {
                debug!("Block {} queued for persistence", block_number);
                Ok(())
            },
            Err(e) => {
                error!("Failed to queue block {} for persistence: {}", block_number, e);
                
                // Reset the persisted flag since we couldn't queue it
                let mut blocks = self.active_blocks.lock().await;
                if let Some(tracked_block) = blocks.get_mut(&block_number) {
                    tracked_block.is_persisted = false;
                }
                
                Err(anyhow::anyhow!("Failed to queue block for persistence: {}", e))
            }
        }
    }
    
    /// Get all blocks that need to be flushed on shutdown
    pub async fn get_blocks_to_flush(&self) -> Vec<Block> {
        let blocks_map = self.active_blocks.lock().await;
        blocks_map.values()
            .filter(|block| !block.is_persisted && !block.buffered_shreds.is_empty())
            .cloned()
            .collect::<Vec<Block>>()
    }
    
    /// Shutdown the persistence worker gracefully
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down block persistence worker");
        
        match self.persist_sender.send(PersistenceMessage::Shutdown).await {
            Ok(_) => {
                info!("Shutdown signal sent to persistence worker");
                Ok(())
            },
            Err(e) => {
                error!("Failed to send shutdown signal to persistence worker: {}", e);
                Err(anyhow::anyhow!("Failed to shut down persistence worker: {}", e))
            }
        }
    }
    
    /// Find blocks that should be persisted due to time limits
    pub async fn find_stale_blocks(&self) -> Vec<Block> {
        let mut blocks_map = self.active_blocks.lock().await;
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
    }
    
    /// Find blocks that should be persisted based on buffer criteria
    pub async fn find_blocks_by_buffer_criteria(&self) -> Vec<Block> {
        let mut blocks_map = self.active_blocks.lock().await;
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
    }
}