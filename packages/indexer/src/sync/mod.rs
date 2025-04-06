mod error;
mod historic;
mod live;
mod manager;
mod fetcher;

pub use error::SyncError;
pub use historic::HistoricSync;
pub use live::LiveSync;
pub use manager::SyncManager;
pub use fetcher::BlockFetcher;

use std::fmt;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Sync state shared between components
pub struct SyncState {
    /// Latest synced block number
    pub latest_synced_block: u64,
    /// Flag to indicate if historic sync is complete
    pub historic_sync_complete: bool,
}

impl SyncState {
    pub fn new(start_block: u64) -> Self {
        Self {
            latest_synced_block: start_block,
            historic_sync_complete: false,
        }
    }
}

impl fmt::Debug for SyncState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncState")
            .field("latest_synced_block", &self.latest_synced_block)
            .field("historic_sync_complete", &self.historic_sync_complete)
            .finish()
    }
}

/// Type alias for shared sync state
pub type SharedSyncState = Arc<Mutex<SyncState>>;
