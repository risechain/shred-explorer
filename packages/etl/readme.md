# ETL Package (Extract, Transform, Load)

This package is responsible for:
1. Connecting to the RISE node WebSocket API
2. Processing shred data
3. Storing it in the PostgreSQL database

## Setup

1. Create a `.env` file from the `.env.example` template:
   ```
   cp .env.example .env
   ```

2. Modify the `.env` file with your database credentials and WebSocket URL:
   ```
   DATABASE_URL=postgres://username:password@localhost:5432/shredexplorer
   WEBSOCKET_URL=wss://staging.riselabs.xyz/ws
   RUST_LOG=info
   ```

3. Install dependencies:
   ```
   cargo build
   ```

## Running the ETL

Start the ETL process with:
```
cargo run
```

The process will:
1. Connect to the WebSocket endpoint specified in WEBSOCKET_URL
2. Subscribe to shred data from the RISE node
3. Process and store the data in the PostgreSQL database

## Troubleshooting Connection Issues

If the application appears to hang or doesn't produce any output when you run it:

1. Run the connection testing script first:
   ```
   ./test_connection.sh
   ```
   This script will check your .env file and test connections to both the database and WebSocket endpoint.

2. If the testing script shows errors:
   - Make sure your PostgreSQL database is running
   - Verify the WebSocket endpoint is correct and reachable
   - Fix any issues identified in your .env file

3. For more detailed logs:
   - Set `RUST_LOG=debug` in your `.env` file
   - You should see console output even if logging isn't working

4. Common WebSocket issues:
   - **TLS/SSL errors**: Make sure you're using `wss://` for secure connections
   - **Connection refused**: The endpoint might be down or unreachable
   - **Invalid response**: The endpoint might not be a valid WebSocket endpoint

## Database Schema

The database schema is defined in the migrations directory:
- `migrations/01_initial_schema.sql`: Creates tables for shreds, transactions, and state changes

## Docker

Build and run with Docker Compose:
```
docker-compose up -d
```

This will start:
1. PostgreSQL database
2. ETL service connected to the specified WebSocket endpoint