# Shred Explorer Database Schema

This document describes the database schema used by the Shred Explorer indexer.

## Blocks Table

The `blocks` table stores blockchain block data and serves as the primary data store for the explorer.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `number` | `BIGINT` | Block number (PRIMARY KEY) |
| `hash` | `TEXT` | Block hash (UNIQUE) |
| `parent_hash` | `TEXT` | Hash of the parent block |
| `timestamp` | `BIGINT` | Block timestamp in Unix time |
| `transactions_root` | `TEXT` | Root hash of the transaction trie |
| `state_root` | `TEXT` | Root hash of the state trie |
| `receipts_root` | `TEXT` | Root hash of the receipts trie |
| `gas_used` | `BIGINT` | Total gas used in the block |
| `gas_limit` | `BIGINT` | Block gas limit |
| `base_fee_per_gas` | `BIGINT` | Base fee per gas (only for EIP-1559 blocks) |
| `extra_data` | `TEXT` | Extra data field |
| `miner` | `TEXT` | Address of the miner/validator |
| `difficulty` | `TEXT` | Block difficulty (stored as string due to large values) |
| `total_difficulty` | `TEXT` | Total chain difficulty at this block (stored as string) |
| `size` | `BIGINT` | Block size in bytes |
| `transaction_count` | `BIGINT` | Number of transactions in the block |
| `transactions` | `JSONB` | JSON array of transaction objects |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | Timestamp when the record was created |
| `updated_at` | `TIMESTAMP WITH TIME ZONE` | Timestamp when the record was last updated |

### Indexes

| Index Name | Columns | Purpose |
|------------|---------|---------|
| `PRIMARY KEY` | `(number)` | Primary key constraint on block number |
| `idx_blocks_parent_hash` | `(parent_hash)` | Optimize queries for blockchain traversal |
| `idx_blocks_timestamp` | `(timestamp)` | Optimize time-based queries |
| `idx_blocks_number_desc` | `(number DESC)` | Optimize queries for latest blocks |

### Transaction JSON Structure

Each transaction in the `transactions` JSONB column has the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `hash` | `String` | Transaction hash |
| `from` | `Option<String>` | Sender address (optional as it could be absent in some special transactions) |
| `to` | `Option<String>` | Recipient address (null for contract creation transactions) |
| `value` | `String` | Transaction value in wei (as string due to large values) |
| `gas` | `u64` | Gas limit for the transaction |
| `gas_price` | `Option<u64>` | Gas price (optional, null for some types of transactions) |
| `input` | `String` | Transaction input data (contract code or function call data) |
| `nonce` | `u64` | Sender's transaction nonce |
| `transaction_index` | `u64` | Index position in the block |
| `block_hash` | `String` | Hash of the containing block |
| `block_number` | `u64` | Block number of the containing block |

## Database Notifications

The database is configured with a notification system that broadcasts events when new blocks are added.

### Notification Function

```sql
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
```

### Notification Trigger

```sql
-- Drop existing trigger if it exists (ensures clean installation)
DROP TRIGGER IF EXISTS block_insert_trigger ON blocks;

-- Create trigger that fires on new block insertion
CREATE TRIGGER block_insert_trigger
AFTER INSERT ON blocks
FOR EACH ROW
EXECUTE FUNCTION notify_new_block();
```

### Notification Channel

The notification is sent on the PostgreSQL channel named `'new_block'` with a JSON payload containing basic block information:

```json
{
  "number": 12345678,
  "hash": "0x...",
  "timestamp": 1678912345,
  "transaction_count": 123
}
```

Applications can listen for these notifications to receive real-time updates when new blocks are added to the database, enabling live dashboards and instant notification features without constant polling.

## Design Considerations

1. **Primary Key**: Block number is used as the primary key for fast lookups by block number.

2. **Upsert Support**: The schema supports upsert operations to handle blockchain reorganizations.

3. **Transaction Storage**: Transactions are stored in a JSONB array within the block record for simplified querying, though in a production system with high transaction volumes, a separate transactions table might be preferred.

4. **Indexing Strategy**: Indexes are created on commonly queried fields to optimize performance.

5. **Notifications**: PostgreSQL notification system is used to broadcast events when new blocks are added, enabling real-time updates for connected clients.