# Ethereum Blockchain Indexer

A Rust-based Ethereum blockchain indexer that synchronizes blocks from EVM-compatible blockchains using ethers-rs and stores them in a PostgreSQL database.

## Features

- **Historical Sync**: Batch processing of historical blocks via HTTP RPC
- **Live Sync**: Real-time monitoring of new blocks via WebSocket
- **PostgreSQL Storage**: Efficient storage of blocks and transactions
- **Resilient Processing**: Automatic retry mechanism with exponential backoff
- **Concurrent Processing**: Configurable parallel request handling
- **Robust Logging**: Comprehensive logging throughout the application

## Requirements

- Rust 1.70+
- PostgreSQL 13+
- Access to an Ethereum RPC endpoint (HTTP and WebSocket)

## Setup

1. Clone the repository

2. Copy the environment file and configure it:
   ```
   cp .env.example .env
   ```

3. Edit the `.env` file with your PostgreSQL credentials and Ethereum RPC endpoints

4. Build the project:
   ```
   cargo build --release
   ```

## Configuration

The application is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `HTTP_PROVIDER_URL` | Ethereum HTTP RPC endpoint | - |
| `WS_PROVIDER_URL` | Ethereum WebSocket RPC endpoint | - |
| `START_BLOCK` | Block number to start syncing from | 0 |
| `BATCH_SIZE` | Number of blocks per batch | 100 |
| `MAX_CONCURRENT_REQUESTS` | Maximum concurrent requests | 10 |
| `RETRY_DELAY` | Base delay between retries (ms) | 1000 |
| `MAX_RETRIES` | Maximum retry attempts | 5 |
| `RUST_LOG` | Log level configuration | ethereum_indexer=info,warn |

## Running

```
cargo run --release
```

## Database Schema

The indexer creates the following PostgreSQL table:

- `blocks`: Stores block data including transactions as JSONB

## Deploy with fly
To deploy the indexer on Fly.io, follow these steps:
1. Install the Fly CLI: https://fly.io/docs/getting-started/installing-flyctl/
2. Login to Fly: `flyctl auth login`
3. Create a new Fly app: `flyctl launch --name <app-name> --image <docker-image>`
4. Set the environment variables using `flyctl secrets set` command:
   ```
   flyctl secrets set DATABASE_URL=<your-database-url>
   flyctl secrets set HTTP_PROVIDER_URL=<your-http-provider-url>
   flyctl secrets set WS_PROVIDER_URL=<your-ws-provider-url>
   flyctl secrets set START_BLOCK=<start-block-number>
   flyctl secrets set BATCH_SIZE=<batch-size>
   flyctl secrets set MAX_CONCURRENT_REQUESTS=<max-concurrent-requests>
   flyctl secrets set RETRY_DELAY=<retry-delay>
   flyctl secrets set MAX_RETRIES=<max-retries>
   ```
5. Deploy the app: `flyctl deploy`

## Tunnel to Fly DB
`
fly proxy 5432 -a indexer-db2
`

## SSH into Fly DB
```
fly ssh console -a indexer-db2
```

## Architecture

The application consists of several components:

- **HistoricSync**: Handles batch processing of historical blocks
- **LiveSync**: Processes new blocks in real-time via WebSocket
- **SyncManager**: Coordinates between historical and live sync
- **Database**: Manages PostgreSQL interactions and migrations

## Error Handling

The application implements a robust error handling strategy:

- Custom error types with descriptive messages
- Automatic retry for transient failures with exponential backoff
- Comprehensive logging of error states

## Libraries Used

- [ethers-rs](https://github.com/gakonst/ethers-rs): Complete Ethereum interaction library with full EIP-1193 support
- [SQLx](https://github.com/launchbadge/sqlx): PostgreSQL database client
- [Tokio](https://github.com/tokio-rs/tokio): Asynchronous runtime
- [Tracing](https://github.com/tokio-rs/tracing): Logging and tracing

## License

MIT