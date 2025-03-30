-- Add blocks table to store block information
CREATE TABLE IF NOT EXISTS blocks (
    number BIGINT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    transaction_count INT NOT NULL DEFAULT 0,
    shred_count INT NOT NULL DEFAULT 0,
    state_change_count INT NOT NULL DEFAULT 0,
    first_shred_id BIGINT REFERENCES shreds(id),
    last_shred_id BIGINT REFERENCES shreds(id),
    block_time BIGINT -- Time taken to process the entire block in milliseconds
);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX IF NOT EXISTS idx_blocks_transaction_count ON blocks(transaction_count);

-- Add block_number index to shreds table if it doesn't exist already
CREATE INDEX IF NOT EXISTS idx_shreds_block_number ON shreds(block_number);