use anyhow::Result;
use sqlx::PgPool;
use tracing::{info, error};

pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations");

    // Create blocks table if it doesn't exist
    let create_blocks_table = r#"
    CREATE TABLE IF NOT EXISTS blocks (
        number BIGINT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        parent_hash TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        transactions_root TEXT NOT NULL,
        state_root TEXT NOT NULL,
        receipts_root TEXT NOT NULL,
        gas_used BIGINT NOT NULL,
        gas_limit BIGINT NOT NULL,
        base_fee_per_gas BIGINT,
        extra_data TEXT NOT NULL,
        miner TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        total_difficulty TEXT,
        size BIGINT NOT NULL,
        transaction_count BIGINT NOT NULL DEFAULT 0,
        transactions JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
    "#;

    // Create index on parent_hash for fast lookups
    let create_parent_hash_index = r#"
    CREATE INDEX IF NOT EXISTS idx_blocks_parent_hash ON blocks (parent_hash)
    "#;

    // Create index on timestamp for time-based queries
    let create_timestamp_index = r#"
    CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks (timestamp)
    "#;
       
    // Create index on block number for sorted queries (DESC for latest blocks first)
    let create_number_index = r#"
    CREATE INDEX IF NOT EXISTS idx_blocks_number_desc ON blocks (number DESC)
    "#;

    // Run all queries individually instead of in a transaction for simpler error handling
    info!("Creating blocks table if it doesn't exist");
    sqlx::query(create_blocks_table)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create blocks table: {}", e);
            e
        })?;

    info!("Creating parent_hash index");
    sqlx::query(create_parent_hash_index)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create parent_hash index: {}", e);
            e
        })?;

    info!("Creating timestamp index");
    sqlx::query(create_timestamp_index)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create timestamp index: {}", e);
            e
        })?;
        
    info!("Creating transaction count index");
        
    info!("Creating block number descending index");
    sqlx::query(create_number_index)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create block number index: {}", e);
            e
        })?;
    
    // Create function for notification
    let create_notification_function = r#"
    CREATE OR REPLACE FUNCTION notify_new_block()
    RETURNS TRIGGER AS $$
    BEGIN
        PERFORM pg_notify('new_block', json_build_object(
            'number', NEW.number,
            'hash', NEW.hash,
            'timestamp', NEW.timestamp,
            'transaction_count', NEW.transaction_count
        )::text);
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    "#;
    
    info!("Creating notification function for new blocks");
    sqlx::query(create_notification_function)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create notification function: {}", e);
            e
        })?;
    
    // Drop existing trigger if it exists
    let drop_trigger = r#"
    DROP TRIGGER IF EXISTS block_insert_trigger ON blocks;
    "#;
    
    info!("Dropping existing trigger if present");
    sqlx::query(drop_trigger)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to drop existing trigger: {}", e);
            e
        })?;
    
    // Create trigger that fires on new block insertion
    let create_trigger = r#"
    CREATE TRIGGER block_insert_trigger
    AFTER INSERT ON blocks
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_block();
    "#;
    
    info!("Creating trigger for new block notifications");
    sqlx::query(create_trigger)
        .execute(pool)
        .await
        .map_err(|e| {
            error!("Failed to create notification trigger: {}", e);
            e
        })?;
    
    info!("Database migrations completed successfully");
    Ok(())
}
