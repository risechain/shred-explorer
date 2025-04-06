use ethers::types::U256;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Block {
    pub number: u64,
    pub hash: String,
    pub parent_hash: String,
    pub timestamp: u64,
    pub transactions_root: String,
    pub state_root: String,
    pub receipts_root: String,
    pub gas_used: u64,
    pub gas_limit: u64,
    pub base_fee_per_gas: Option<u64>,
    pub extra_data: String,
    pub miner: String,
    pub difficulty: U256,
    pub total_difficulty: Option<U256>,
    pub size: u64,
    pub transactions: Vec<Transaction>,
}

impl Block {
    // Helper to create a dummy block for testing
    pub fn dummy(number: u64) -> Self {
        Self {
            number,
            hash: format!("0xhash{}", number),
            parent_hash: format!("0xparent{}", number),
            timestamp: 1678912345 + number,
            transactions_root: "0xtxroot".to_string(),
            state_root: "0xstateroot".to_string(),
            receipts_root: "0xreceiptsroot".to_string(),
            gas_used: 21000,
            gas_limit: 30000000,
            base_fee_per_gas: Some(1000000000),
            extra_data: "0x".to_string(),
            miner: "0xminer".to_string(),
            difficulty: U256::from(2),
            total_difficulty: Some(U256::from(100)),
            size: 1000,
            transactions: vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub hash: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub value: String,
    pub gas: u64,
    pub gas_price: Option<u64>,
    pub input: String,
    pub nonce: u64,
    pub transaction_index: u64,
    pub block_hash: String,
    pub block_number: u64,
}

// Block with transaction hashes only (used in websocket streaming)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockHeader {
    pub number: u64,
    pub hash: String,
    pub parent_hash: String,
    pub timestamp: u64,
    pub transactions_root: String,
    pub state_root: String,
    pub receipts_root: String,
    pub gas_used: u64,
    pub gas_limit: u64,
    pub base_fee_per_gas: Option<u64>,
    pub extra_data: String,
    pub miner: String,
    pub difficulty: U256,
    pub total_difficulty: Option<U256>,
    pub size: u64,
    pub transactions: Vec<String>, // Just transaction hashes
}
