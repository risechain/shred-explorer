use crate::models::Block;
use crossbeam_queue::SegQueue;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use tracing::{debug, error, info, warn};

/// Maximum number of blocks that can be in the queue
const DEFAULT_MAX_QUEUE_SIZE: usize = 1000;

/// Block queue for decoupling fetching from database persistence
pub struct BlockQueue {
    /// The actual queue holding blocks
    queue: Arc<SegQueue<Block>>,
    /// Semaphore to limit the queue size
    semaphore: Arc<Semaphore>,
    /// Maximum queue size
    max_size: usize,
}

impl BlockQueue {
    /// Create a new block queue with the default max size
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_MAX_QUEUE_SIZE)
    }

    /// Create a new block queue with a specific capacity
    pub fn with_capacity(max_size: usize) -> Self {
        info!("Creating block queue with capacity {}", max_size);
        Self {
            queue: Arc::new(SegQueue::new()),
            semaphore: Arc::new(Semaphore::new(max_size)),
            max_size,
        }
    }

    /// Get the current queue length
    pub fn len(&self) -> usize {
        // This is an approximation since SegQueue doesn't have a len() method
        self.max_size - self.semaphore.available_permits()
    }

    /// Check if the queue is empty
    pub fn is_empty(&self) -> bool {
        self.semaphore.available_permits() == self.max_size
    }

    /// Get the maximum size of the queue
    pub fn capacity(&self) -> usize {
        self.max_size
    }

    /// Push a block into the queue, waiting if the queue is full
    pub async fn push(&self, block: Block) -> Result<(), tokio::sync::AcquireError> {
        // Acquire a permit from the semaphore, waiting if necessary
        let permit = self.semaphore.acquire().await?;

        // Push the block onto the queue
        self.queue.push(block);
        
        // Log queue status periodically
        let current_size = self.len();
        if current_size % 100 == 0 || current_size >= self.max_size - 10 {
            info!("Block queue size: {}/{}", current_size, self.max_size);
        } else {
            debug!("Block queue size: {}/{}", current_size, self.max_size);
        }

        // When the permit is dropped, it's automatically released
        std::mem::forget(permit);
        Ok(())
    }

    /// Push a block into the queue, returning immediately if the queue is full
    pub fn try_push(&self, block: Block) -> bool {
        match self.semaphore.try_acquire() {
            Ok(permit) => {
                self.queue.push(block);
                
                // Log queue status periodically
                let current_size = self.len();
                if current_size % 100 == 0 || current_size >= self.max_size - 10 {
                    info!("Block queue size: {}/{}", current_size, self.max_size);
                } else {
                    debug!("Block queue size: {}/{}", current_size, self.max_size);
                }
                
                std::mem::forget(permit);
                true
            }
            Err(_) => {
                warn!("Queue is full, cannot push block");
                false
            }
        }
    }

    /// Try to pop a block from the queue, returning None if the queue is empty
    pub fn try_pop(&self) -> Option<Block> {
        match self.queue.pop() {
            Some(block) => {
                // Release a permit back to the semaphore
                self.semaphore.add_permits(1);
                Some(block)
            }
            None => None,
        }
    }

    /// Get a clone of the queue and semaphore for a new worker
    pub fn clone_queue(&self) -> BlockQueue {
        Self {
            queue: Arc::clone(&self.queue),
            semaphore: Arc::clone(&self.semaphore),
            max_size: self.max_size,
        }
    }
}

/// Status of the block persistence processor
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessorStatus {
    Running,
    Paused,
    Stopped,
}

/// Block processor for saving blocks to the database
pub struct BlockProcessor {
    /// The queue to process
    queue: BlockQueue,
    /// Status mutex to control processing
    status: Arc<Mutex<ProcessorStatus>>,
}

impl BlockProcessor {
    /// Create a new block processor
    pub fn new(queue: BlockQueue) -> Self {
        Self {
            queue,
            status: Arc::new(Mutex::new(ProcessorStatus::Stopped)),
        }
    }

    /// Start the processor
    pub async fn start(&self, db: Arc<crate::db::Database>) {
        // Set status to running
        let mut status = self.status.lock().await;
        *status = ProcessorStatus::Running;
        drop(status);
        
        info!("Starting block processor");
        
        // Clone necessary data for the worker task
        let queue = self.queue.clone_queue();
        let status_arc = Arc::clone(&self.status);
        
        // Spawn a worker task
        tokio::spawn(async move {
            Self::worker_loop(queue, db, status_arc).await;
        });
    }

    /// Pause the processor
    pub async fn pause(&self) -> bool {
        let mut status = self.status.lock().await;
        if *status == ProcessorStatus::Running {
            *status = ProcessorStatus::Paused;
            info!("Block processor paused");
            true
        } else {
            warn!("Cannot pause block processor: not running");
            false
        }
    }

    /// Resume the processor
    pub async fn resume(&self) -> bool {
        let mut status = self.status.lock().await;
        if *status == ProcessorStatus::Paused {
            *status = ProcessorStatus::Running;
            info!("Block processor resumed");
            true
        } else {
            warn!("Cannot resume block processor: not paused");
            false
        }
    }

    /// Stop the processor
    pub async fn stop(&self) -> bool {
        let mut status = self.status.lock().await;
        if *status != ProcessorStatus::Stopped {
            *status = ProcessorStatus::Stopped;
            info!("Block processor stopped");
            true
        } else {
            warn!("Block processor already stopped");
            false
        }
    }

    /// Get current processor status
    pub async fn status(&self) -> ProcessorStatus {
        *self.status.lock().await
    }

    /// Worker loop for processing blocks
    async fn worker_loop(queue: BlockQueue, db: Arc<crate::db::Database>, status: Arc<Mutex<ProcessorStatus>>) {
        info!("Block processor worker started");
        
        let mut consecutive_empty = 0;
        
        // Process until stopped
        loop {
            // Check status
            let current_status = *status.lock().await;
            match current_status {
                ProcessorStatus::Stopped => {
                    info!("Block processor worker stopping");
                    break;
                }
                ProcessorStatus::Paused => {
                    debug!("Block processor paused, waiting...");
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    continue;
                }
                ProcessorStatus::Running => {
                    // Try to get a block from the queue
                    if let Some(block) = queue.try_pop() {
                        consecutive_empty = 0;
                        
                        // Process the block
                        let block_number = block.number; // Store block number for error reporting
                        match db.save_block(&block).await {
                            Ok(_) => {
                                debug!("Saved block {} to database", block_number);
                            }
                            Err(e) => {
                                error!("Failed to save block {} to database: {}", block_number, e);
                                // Re-push failed blocks to the queue
                                if !queue.try_push(block) {
                                    error!("Could not requeue block {} due to full queue", block_number);
                                }
                            }
                        }
                    } else {
                        consecutive_empty += 1;
                        if consecutive_empty >= 10 {
                            // If queue has been empty for a while, sleep a bit longer
                            debug!("Block queue empty, waiting...");
                            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                            consecutive_empty = 0;
                        } else {
                            // Small sleep to prevent CPU spinning
                            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                        }
                    }
                }
            }
        }
        
        // Process any remaining blocks before exiting
        info!("Processing remaining blocks before shutdown");
        while let Some(block) = queue.try_pop() {
            let block_number = block.number; // Store block number for error reporting
            match db.save_block(&block).await {
                Ok(_) => {
                    debug!("Saved block {} to database", block_number);
                }
                Err(e) => {
                    error!("Failed to save block {} to database: {}", block_number, e);
                }
            }
        }
        
        info!("Block processor worker completed");
    }
}