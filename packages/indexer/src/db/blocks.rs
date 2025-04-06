use anyhow::{Result, Context};
use sqlx::{PgPool, Row};
use tracing::{debug, error, instrument};
use sqlx::postgres::PgQueryResult;
use sqlx::types::Json;

use crate::models::Block;

#[instrument(skip(pool, block), fields(block_number = block.number, block_hash = %block.hash))]
pub async fn save_block(pool: &PgPool, block: &Block) -> Result<()> {
    debug!("Saving block {} to database", block.number);
    
    // Convert U256 fields to strings for storage
    let difficulty = block.difficulty.to_string();
    let total_difficulty = block.total_difficulty
        .map(|td| td.to_string())
        .unwrap_or_default();
    
    // Serialize transactions to JSON with additional error handling
    let transactions_json = match serde_json::to_value(&block.transactions) {
        Ok(json) => json,
        Err(e) => {
            error!("Failed to serialize transactions for block {}: {}", block.number, e);
            // Create an empty array as fallback
            serde_json::Value::Array(Vec::new())
        }
    };
    
    // Upsert query to handle potential re-orgs
    let query = r#"
    INSERT INTO blocks (
        number, hash, parent_hash, timestamp, transactions_root,
        state_root, receipts_root, gas_used, gas_limit, base_fee_per_gas,
        extra_data, miner, difficulty, total_difficulty, size, transaction_count, transactions
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (number) DO UPDATE SET
        hash = EXCLUDED.hash,
        parent_hash = EXCLUDED.parent_hash,
        timestamp = EXCLUDED.timestamp,
        transactions_root = EXCLUDED.transactions_root,
        state_root = EXCLUDED.state_root,
        receipts_root = EXCLUDED.receipts_root,
        gas_used = EXCLUDED.gas_used,
        gas_limit = EXCLUDED.gas_limit,
        base_fee_per_gas = EXCLUDED.base_fee_per_gas,
        extra_data = EXCLUDED.extra_data,
        miner = EXCLUDED.miner,
        difficulty = EXCLUDED.difficulty,
        total_difficulty = EXCLUDED.total_difficulty,
        size = EXCLUDED.size,
        transaction_count = EXCLUDED.transaction_count, 
        transactions = EXCLUDED.transactions,
        updated_at = CURRENT_TIMESTAMP
    "#;
    
    let result: Result<PgQueryResult, sqlx::Error> = sqlx::query(query)
        .bind(block.number as i64)
        .bind(&block.hash)
        .bind(&block.parent_hash)
        .bind(block.timestamp as i64)
        .bind(&block.transactions_root)
        .bind(&block.state_root)
        .bind(&block.receipts_root)
        .bind(block.gas_used as i64)
        .bind(block.gas_limit as i64)
        .bind(block.base_fee_per_gas.map(|fee| fee as i64))
        .bind(&block.extra_data)
        .bind(&block.miner)
        .bind(&difficulty)
        .bind(&total_difficulty)
        .bind(block.size as i64)
        .bind(block.transaction_count as i64)
        .bind(transactions_json)
        .execute(pool)
        .await;
    
    match result {
        Ok(res) => {
            debug!("Block {} saved successfully. Affected rows: {}", block.number, res.rows_affected());
            Ok(())
        },
        Err(e) => {
            error!("Failed to save block {}: {}", block.number, e);
            Err(e.into())
        }
    }
}

#[instrument(skip(pool))]
pub async fn get_latest_block_number(pool: &PgPool) -> Result<Option<u64>> {
    debug!("Fetching latest block number from database");
    
    // Use the optimized index for faster MAX lookup
    let query = "SELECT MAX(number) as latest FROM blocks";
    
    let result = sqlx::query(query)
        .fetch_optional(pool)
        .await;
    
    match result {
        Ok(row) => {
            let latest = match row {
                Some(row) => {
                    let number: Option<i64> = row.try_get("latest").ok();
                    number.map(|n| n as u64)
                },
                None => None,
            };
            debug!("Latest block number from database: {:?}", latest);
            Ok(latest)
        },
        Err(e) => {
            error!("Failed to get latest block number: {}", e);
            Err(e.into())
        }
    }
}

#[instrument(skip(pool))]
pub async fn get_head_block(pool: &PgPool) -> Result<Option<crate::models::Block>> {
    debug!("Fetching head block from database");
    
    // Use the optimized index for this query - ORDER BY number DESC LIMIT 1 is efficient with our index
    let query = "SELECT * FROM blocks ORDER BY number DESC LIMIT 1";
    
    let result = sqlx::query_as::<_, BlockRow>(query)
        .fetch_optional(pool)
        .await;
    
    match result {
        Ok(row) => {
            let block = row.map(|r| r.into_block())
                .transpose()?;
            match &block {
                Some(b) => debug!("Head block found: {}", b.number),
                None => debug!("No blocks found in database"),
            }
            Ok(block)
        },
        Err(e) => {
            error!("Failed to get head block: {}", e);
            Err(e.into())
        }
    }
}

#[instrument(skip(pool))]
pub async fn get_blocks_paginated(
    pool: &PgPool, 
    offset: u64, 
    limit: u64, 
    descending: bool
) -> Result<Vec<crate::models::Block>> {
    debug!("Fetching paginated blocks with offset {} and limit {}", offset, limit);
    
    // Use the optimized index for efficient pagination
    let query = if descending {
        "SELECT * FROM blocks ORDER BY number DESC LIMIT $1 OFFSET $2"
    } else {
        "SELECT * FROM blocks ORDER BY number ASC LIMIT $1 OFFSET $2"
    };
    
    let result = sqlx::query_as::<_, BlockRow>(query)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(pool)
        .await;
    
    match result {
        Ok(rows) => {
            let blocks: Result<Vec<_>> = rows.into_iter()
                .map(|row| row.into_block())
                .collect();
            
            let blocks = blocks?;
            debug!("Fetched {} blocks", blocks.len());
            
            Ok(blocks)
        },
        Err(e) => {
            error!("Failed to get paginated blocks: {}", e);
            Err(e.into())
        }
    }
}

#[instrument(skip(pool), fields(block_number = block_number))]
pub async fn get_block_by_number(pool: &PgPool, block_number: u64) -> Result<Option<Block>> {
    debug!("Fetching block {} from database", block_number);
    
    let query = "SELECT * FROM blocks WHERE number = $1";
    
    let result = sqlx::query_as::<_, BlockRow>(query)
        .bind(block_number as i64)
        .fetch_optional(pool)
        .await;
    
    match result {
        Ok(row) => {
            let block = row.map(|r| r.into_block())
                .transpose()?;
            match &block {
                Some(_) => debug!("Block {} found in database", block_number),
                None => debug!("Block {} not found in database", block_number),
            }
            Ok(block)
        },
        Err(e) => {
            error!("Failed to get block {}: {}", block_number, e);
            Err(e.into())
        }
    }
}

#[instrument(skip(pool), fields(block_hash = %block_hash))]
pub async fn get_block_by_hash(pool: &PgPool, block_hash: &str) -> Result<Option<Block>> {
    debug!("Fetching block with hash {} from database", block_hash);
    
    let query = "SELECT * FROM blocks WHERE hash = $1";
    
    let result = sqlx::query_as::<_, BlockRow>(query)
        .bind(block_hash)
        .fetch_optional(pool)
        .await;
    
    match result {
        Ok(row) => {
            let block = row.map(|r| r.into_block())
                .transpose()?;
            match &block {
                Some(b) => debug!("Block with hash {} found in database (block number: {})", block_hash, b.number),
                None => debug!("Block with hash {} not found in database", block_hash),
            }
            Ok(block)
        },
        Err(e) => {
            error!("Failed to get block by hash {}: {}", block_hash, e);
            Err(e.into())
        }
    }
}

// Helper struct for database queries
#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct BlockRow {
    number: i64,
    hash: String,
    parent_hash: String,
    timestamp: i64,
    transactions_root: String,
    state_root: String,
    receipts_root: String,
    gas_used: i64,
    gas_limit: i64,
    base_fee_per_gas: Option<i64>,
    extra_data: String,
    miner: String,
    difficulty: String,
    total_difficulty: Option<String>,
    size: i64,
    transaction_count: i64,
    transactions: Json<Vec<crate::models::Transaction>>,
}

#[allow(dead_code)]
impl BlockRow {
    fn into_block(self) -> Result<Block> {
        use ethers::types::U256;
        
        // Parse difficulty and total_difficulty from string back to U256
        let difficulty = U256::from_dec_str(&self.difficulty)
            .context("Failed to parse difficulty")?;
        
        let total_difficulty = if let Some(td) = self.total_difficulty {
            if !td.is_empty() {
                Some(U256::from_dec_str(&td).context("Failed to parse total_difficulty")?)
            } else {
                None
            }
        } else {
            None
        };
        
        Ok(Block {
            number: self.number as u64,
            hash: self.hash,
            parent_hash: self.parent_hash,
            timestamp: self.timestamp as u64,
            transactions_root: self.transactions_root,
            state_root: self.state_root,
            receipts_root: self.receipts_root,
            gas_used: self.gas_used as u64,
            gas_limit: self.gas_limit as u64,
            base_fee_per_gas: self.base_fee_per_gas.map(|fee| fee as u64),
            extra_data: self.extra_data,
            miner: self.miner,
            difficulty,
            total_difficulty,
            size: self.size as u64,
            transaction_count: self.transaction_count as u64,
            transactions: self.transactions.0,
        })
    }
}
