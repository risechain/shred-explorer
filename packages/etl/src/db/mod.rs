pub mod generated;

use anyhow::{Context, Result};
use std::error::Error;
use sqlx::PgPool;
use tracing::{info, error, debug};

use crate::models::{Block, Shred};

/// Sets up the database schema
pub async fn setup_database(pool: &PgPool) -> Result<()> {
    // Let SQLx handle the schema migrations with detailed error handling
    println!("Running database migrations from ./migrations directory...");
    
    match sqlx::migrate!("./migrations").run(pool).await {
        Ok(_) => {
            println!("Database migrations completed successfully!");
            Ok(())
        },
        Err(e) => {
            // Format detailed error message
            let error_message = format!("Failed to create database schema: {}", e);
            println!("MIGRATION ERROR: {}", error_message);
            
            // Print additional error details if available
            if let Some(source) = e.source() {
                println!("Caused by: {}", source);
                
                // Go deeper into the error chain
                if let Some(next_source) = source.source() {
                    println!("Root cause: {}", next_source);
                }
            }
            
            println!("Check that your database is properly set up and the migrations directory is accessible.");
            Err(anyhow::anyhow!(error_message))
        }
    }
}

/// Saves a single shred to the database and returns the shred id
/// This is now only used for testing or direct insertion of individual shreds
pub async fn save_shred(pool: &PgPool, shred: &Shred) -> Result<i64> {
    // Create vector with just this shred and use batch function
    let shreds = vec![shred.clone()];
    let ids = save_shreds_batch(pool, &shreds).await?;
    
    // Return the first (and only) id
    Ok(ids[0])
}

/// Saves a batch of shreds to the database in a single transaction
pub async fn save_shreds_batch(pool: &PgPool, shreds: &[Shred]) -> Result<Vec<i64>> {
    if shreds.is_empty() {
        return Ok(Vec::new()); // Nothing to do
    }
    
    // Start transaction
    let mut tx = pool.begin().await?;
    let mut shred_ids = Vec::with_capacity(shreds.len());
    
    // Process each shred
    for shred in shreds {
        let transaction_count = shred.transactions.len() as i32;
        let state_change_count = shred.state_changes.len() as i32;
        
        // Insert the shred - since shreds arrive in order, we should never have conflicts
        let query = if shred.shred_interval.is_some() {
            sqlx::query_scalar::<_, i64>(
                r#"
                INSERT INTO shreds (block_number, shred_idx, transaction_count, state_change_count, timestamp, shred_interval)
                VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6)
                RETURNING id
                "#,
            )
            .bind(shred.block_number)
            .bind(shred.shred_idx)
            .bind(transaction_count)
            .bind(state_change_count)
            .bind(&shred.timestamp)
            .bind(shred.shred_interval)
        } else {
            sqlx::query_scalar::<_, i64>(
                r#"
                INSERT INTO shreds (block_number, shred_idx, transaction_count, state_change_count, timestamp)
                VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
                RETURNING id
                "#,
            )
            .bind(shred.block_number)
            .bind(shred.shred_idx)
            .bind(transaction_count)
            .bind(state_change_count)
            .bind(&shred.timestamp)
        };
        
        // Execute the query
        let shred_id = query.fetch_one(&mut *tx)
            .await
            .context("Failed to insert shred record")?;
        
        shred_ids.push(shred_id);
        
        // Insert transactions
        for transaction in &shred.transactions {
            // Serialize the structured transaction and receipt data to JSON
            let transaction_json = serde_json::to_value(&transaction.transaction)
                .context("Failed to serialize transaction data")?;
            let receipt_json = serde_json::to_value(&transaction.receipt)
                .context("Failed to serialize receipt data")?;
                
            sqlx::query(
                r#"
                INSERT INTO transactions (shred_id, transaction_data, receipt_data)
                VALUES ($1, $2, $3)
                "#,
            )
            .bind(shred_id)
            .bind(transaction_json)
            .bind(receipt_json)
            .execute(&mut *tx)
            .await
            .context("Failed to insert transaction record")?;
        }
        
        // Insert state changes
        for (address, state_change) in &shred.state_changes {
            sqlx::query(
                r#"
                INSERT INTO state_changes (shred_id, address, nonce, balance, code, storage)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
            )
            .bind(shred_id)
            .bind(address)
            .bind(state_change.nonce)
            .bind(&state_change.balance)
            .bind(&state_change.code)
            .bind(&state_change.storage)
            .execute(&mut *tx)
            .await
            .context("Failed to insert state change record")?;
        }
    }
    
    // Commit transaction
    tx.commit()
        .await
        .context("Failed to commit database transaction")?;
    
    info!(
        "Saved batch of {} shreds to database",
        shreds.len()
    );
    
    Ok(shred_ids)
}

/// Saves a block to the database
pub async fn save_block(pool: &PgPool, block: &Block) -> Result<()> {
    // Use a transaction for all operations
    let mut tx = pool.begin().await
        .context("Failed to start transaction for block save")?;
    
    // Removed table creation since we're using migrations
    // Tables should already exist before ETL starts

    // Insert or update block with detailed error handling  
    let result = sqlx::query(
        r#"
        INSERT INTO blocks (
            number, 
            timestamp, 
            transaction_count, 
            shred_count, 
            state_change_count, 
            first_shred_id, 
            last_shred_id, 
            block_time,
            avg_tps,
            avg_shred_interval
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(block.number)
    .bind(block.timestamp)
    .bind(block.transaction_count)
    .bind(block.shred_count)
    .bind(block.state_change_count)
    .bind(block.first_shred_id)
    .bind(block.last_shred_id)
    .bind(block.block_time)
    .bind(block.avg_tps)
    .bind(block.avg_shred_interval)
    .execute(&mut *tx)
    .await;
    
    // Handle query errors with detailed diagnostics
    if let Err(e) = result {
        // Roll back the transaction
        let _ = tx.rollback().await;
        
        error!(
            "Failed to insert/update block {}: {:?}", 
            block.number, e
        );
        
        // Log detailed block information to help diagnose
        error!(
            "Block details: number={}, timestamp={:?}, tx_count={}, shred_count={}, state_changes={}, first_id={:?}, last_id={:?}, block_time={:?}, avg_tps={:?}, avg_shred_interval={:?}",
            block.number,
            block.timestamp,
            block.transaction_count,
            block.shred_count,
            block.state_change_count,
            block.first_shred_id,
            block.last_shred_id,
            block.block_time,
            block.avg_tps,
            block.avg_shred_interval
        );
        
        return Err(anyhow::anyhow!("Failed to insert/update block record: {}", e));
    }
    
    // Commit the transaction
    tx.commit().await
        .context("Failed to commit block save transaction")?;

    info!(
        "Saved block {}: shreds={}, tx={}, state_changes={}, time={}ms, avg_tps={:.2}, avg_interval={:.2}ms",
        block.number,
        block.shred_count,
        block.transaction_count,
        block.state_change_count,
        block.block_time.unwrap_or(0),
        block.avg_tps.unwrap_or(0.0),
        block.avg_shred_interval.unwrap_or(0.0)
    );

    Ok(())
}

/// Persists all buffered shreds in a block and then the block itself
pub async fn persist_block_with_shreds(pool: &PgPool, block: &mut Block) -> Result<()> {
    // Mark persistence intention early for better debugging
    let block_number = block.number;
    let buffered_count = block.buffered_shreds.len();
    
    // If no shreds to save, just update the block
    if buffered_count == 0 {
        info!("No buffered shreds for block {}, just updating block info", block_number);
        match save_block(pool, block).await {
            Ok(_) => {
                block.mark_persisted();
                return Ok(());
            },
            Err(e) => {
                error!("Failed to save empty block {}: {}", block_number, e);
                return Err(e);
            }
        }
    }
    
    // Save the batch of shreds
    let batch_start = std::time::Instant::now();
    
    // Clone the buffered shreds to avoid borrowing issues
    let shreds_to_save = block.buffered_shreds.clone();
    
    // Save the batch and get returned IDs
    let shred_ids = match save_shreds_batch(pool, &shreds_to_save).await {
        Ok(ids) => ids,
        Err(e) => {
            error!("Failed to save {} shreds for block {}: {}", buffered_count, block_number, e);
            std::process::exit(1); // Terminate the process with error code 1
        }
    };
    
    // Record elapsed time
    let elapsed = batch_start.elapsed();
    info!(
        "Persisted {} shreds for block {} in {:.2}s ({:.2} shreds/s)",
        buffered_count,
        block_number,
        elapsed.as_secs_f32(),
        buffered_count as f32 / elapsed.as_secs_f32()
    );
    
    // We need to map the in-memory shred indexes to actual database IDs for storage
    // The buffered_shreds are in the order they were received, not necessarily by shred_idx
    if !shred_ids.is_empty() {
        // Find the shred with the lowest and highest index in the buffer
        let mut min_idx_pos = 0;
        let mut max_idx_pos = 0;
        
        for (i, shred) in block.buffered_shreds.iter().enumerate() {
            if i == 0 || shred.shred_idx < block.buffered_shreds[min_idx_pos].shred_idx {
                min_idx_pos = i;
            }
            if i == 0 || shred.shred_idx > block.buffered_shreds[max_idx_pos].shred_idx {
                max_idx_pos = i;
            }
        }
        
        // Get the database IDs that correspond to these shreds
        let first_shred_id = shred_ids[min_idx_pos];
        let last_shred_id = shred_ids[max_idx_pos];
        
        // Update the block with real database IDs
        block.first_shred_id = Some(first_shred_id);
        block.last_shred_id = Some(last_shred_id);
        
        debug!("Updated block {} with database IDs: first_shred_id={}, last_shred_id={}", 
              block.number, first_shred_id, last_shred_id);
    }
    
    // Try to save the block with explicit error handling
    match save_block(pool, block).await {
        Ok(_) => {
            // Mark as persisted
            block.mark_persisted();
            debug!("Successfully persisted block {} with {} shreds", block_number, buffered_count);
            Ok(())
        },
        Err(e) => {
            error!("Failed to save block {} after saving {} shreds: {}", block_number, buffered_count, e);
            Err(e)
        }
    }
}

// The get_block function has been removed since the ETL should not read from the database.
// All block data should be managed in memory and only written to the database.