use anyhow::{Context, Result};
use tokio::time::Duration;
use tokio_tungstenite::connect_async;
use tracing::{error, info};
use url::Url;

/// Normalize a WebSocket URL by adding protocol and path if needed
pub fn normalize_websocket_url(input_url: &str) -> Result<Url> {
    let mut url_str = input_url.trim().to_string();
    
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
    
    // Parse the URL
    let url = Url::parse(&url_str)
        .context("Failed to parse WebSocket URL")?;
    
    Ok(url)
}

/// Test WebSocket connection with diagnostic information
pub async fn test_websocket_connection(websocket_url: &str) -> Result<()> {
    info!("Testing WebSocket connection to: {}", websocket_url);
    
    // Parse and normalize WebSocket URL
    let url = normalize_websocket_url(websocket_url)?;
    
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