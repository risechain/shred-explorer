# Block Watcher

A utility to monitor new blockchain blocks being added to the database in real-time.

## Overview

This tool connects to the PostgreSQL database used by the Ethereum indexer and listens for notifications whenever a new block is inserted. It then displays the block information in a nicely formatted way in the terminal.

## Usage

First, make sure the indexer is running and has created the database and notification triggers.

Then you can run the block watcher in another terminal:

```bash
# From the indexer directory
cargo run --bin block-watcher

# If you're in another directory
cargo run --bin block-watcher --manifest-path /path/to/indexer/Cargo.toml
```

Or you can build and run the binary:

```bash
# Build the binary
cargo build --release --bin block-watcher

# Run the binary
./target/release/block-watcher
```

## Configuration

The block watcher uses the following environment variables:

- `DATABASE_URL`: The PostgreSQL connection string (defaults to `postgres://postgres:postgres@localhost:5432/postgres` if not specified)

You can set these variables in your environment or in a `.env` file in the working directory.

For example:

```bash
# Set the database URL directly
DATABASE_URL=postgres://user:password@localhost:5432/blockchain_db cargo run --bin block-watcher

# Or create a .env file
echo "DATABASE_URL=postgres://user:password@localhost:5432/blockchain_db" > .env
cargo run --bin block-watcher
```

## Requirements

For this tool to work:

1. The indexer must be running and connected to the same database
2. The database must have the `notify_new_block()` trigger function set up (included in the indexer's migrations)

## How It Works

The block watcher:

1. Connects to the PostgreSQL database
2. Sets up a listener for the `new_block` notification channel
3. Waits for notifications when new blocks are inserted
4. Parses and displays the block information in a colorful, easy-to-read format

This is possible because the indexer's database includes a trigger that sends a notification with block details whenever a new block is inserted.