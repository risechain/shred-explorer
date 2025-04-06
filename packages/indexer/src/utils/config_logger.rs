use tracing::info;

pub fn log_config(config: &crate::config::Config) {
    // Log basic configuration
    info!(
        "Config settings: start_block={}, batch_size={}, max_concurrent_requests={}, rpc_batch_size={}",
        config.start_block, config.batch_size, config.max_concurrent_requests, config.rpc_batch_size
    );
    
    // Log blocks_from_tip if set
    if let Some(blocks_from_tip) = config.blocks_from_tip {
        info!("Indexing {} blocks from chain tip", blocks_from_tip);
    }
}