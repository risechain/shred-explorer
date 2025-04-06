use anyhow::Result;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::info;

mod blocks;
mod migrations;

pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(20)
            .acquire_timeout(Duration::from_secs(30))
            .connect(database_url)
            .await?;

        Ok(Self { pool })
    }

    pub async fn migrate(self) -> Result<Self> {
        info!("Running database migrations");
        migrations::run_migrations(&self.pool).await?;
        Ok(self)
    }

    pub async fn save_block(&self, block: &crate::models::Block) -> Result<()> {
        blocks::save_block(&self.pool, block).await
    }

    pub async fn get_latest_block_number(&self) -> Result<Option<u64>> {
        blocks::get_latest_block_number(&self.pool).await
    }
    
    #[allow(dead_code)]
    pub async fn get_block_by_number(&self, block_number: u64) -> Result<Option<crate::models::Block>> {
        blocks::get_block_by_number(&self.pool, block_number).await
    }
    
    #[allow(dead_code)]
    pub async fn get_block_by_hash(&self, block_hash: &str) -> Result<Option<crate::models::Block>> {
        blocks::get_block_by_hash(&self.pool, block_hash).await
    }
}
