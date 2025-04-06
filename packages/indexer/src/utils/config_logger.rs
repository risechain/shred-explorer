use tracing::{info, warn};

pub fn log_config(config: &crate::config::Config) {
    info!(
        "Config settings: batch_size={}, max_concurrent_requests={}, rpc_batch_size={}",
        config.batch_size, config.max_concurrent_requests, config.rpc_batch_size
    );
}