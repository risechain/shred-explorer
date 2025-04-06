use anyhow::Result;
use sqlx::{PgPool, Postgres};
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

    info!("Database migrations completed successfully");
    Ok(())
}
