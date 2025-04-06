use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)] // Some variants not used yet but kept for future use
pub enum SyncError {
    #[error("Provider error: {0}")]
    Provider(String),
    
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("JSON serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("HTTP client error: {0}")]
    Http(String),
    
    #[error("WebSocket error: {0}")]
    WebSocket(String),
    
    #[error("Block not found: {0}")]
    BlockNotFound(u64),
    
    #[error("JSON-RPC error: {0}")]
    JsonRpc(String),
    
    #[error("Parse error: {0}")]
    Parse(String),
    
    #[error("Unexpected error: {0}")]
    Other(String),
}

impl From<anyhow::Error> for SyncError {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

// Note: In a real implementation, we would add proper error conversions
// for each specific error type from the Alloy library
