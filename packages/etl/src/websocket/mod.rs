mod connection;
mod processor;
mod message_handler;
mod block_manager;

// Re-export public interfaces
pub use connection::test_websocket_connection;
pub use processor::process_websocket;