-- name: insert_shred : one
INSERT INTO shreds (block_number, shred_idx, transaction_count, state_change_count, timestamp)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (block_number, shred_idx) DO UPDATE
SET transaction_count = $3, state_change_count = $4
RETURNING id;

-- name: insert_transaction
INSERT INTO transactions (shred_id, transaction_data, receipt_data)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: insert_state_change
INSERT INTO state_changes (shred_id, address, nonce, balance, code, storage)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING;
