-- Schema file, not used by cornucopia
-- This file is only for database setup, not query generation

CREATE TABLE IF NOT EXISTS shreds (
    id BIGSERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    shred_idx BIGINT NOT NULL,
    transaction_count INT NOT NULL,
    state_change_count INT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(block_number, shred_idx)
);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    shred_id BIGINT NOT NULL REFERENCES shreds(id),
    transaction_data JSONB NOT NULL,
    receipt_data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS state_changes (
    id BIGSERIAL PRIMARY KEY,
    shred_id BIGINT NOT NULL REFERENCES shreds(id),
    address TEXT NOT NULL,
    nonce BIGINT NOT NULL,
    balance TEXT NOT NULL,
    code TEXT NOT NULL,
    storage JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shreds_block_number ON shreds(block_number);
CREATE INDEX IF NOT EXISTS idx_transactions_shred_id ON transactions(shred_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_shred_id ON state_changes(shred_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_address ON state_changes(address);