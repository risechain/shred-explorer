use anyhow::Result;
use tracing::{error, info};

use super::{HistoricSync, LiveSync, SyncError};

/// Manages the synchronization process between historic and live modes
pub struct SyncManager {
    historic_sync: HistoricSync,
    live_sync: LiveSync,
}

impl SyncManager {
    pub fn new(historic_sync: HistoricSync, live_sync: LiveSync) -> Self {
        Self {
            historic_sync,
            live_sync,
        }
    }
    
    /// Start the sync process with both components
    pub async fn start(self) -> Result<(), SyncError> {
        info!("Starting sync manager");
        
        // Run historical sync first
        match self.historic_sync.start().await {
            Ok(_) => info!("Historical sync completed successfully"),
            Err(e) => {
                error!("Historical sync failed: {}", e);
                return Err(e);
            }
        }
        
        // Then run live sync
        match self.live_sync.start().await {
            Ok(_) => info!("Live sync completed successfully"),
            Err(e) => {
                error!("Live sync failed: {}", e);
                return Err(e);
            }
        }
        
        info!("Sync manager shutdown");
        Ok(())
        
        // Note: In a real implementation, we would use tokio::spawn to run these in parallel
        // But that introduces lifetime issues we're avoiding for this example
    }
}