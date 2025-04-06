# Shred Explorer API Server

The API server provides both REST and WebSocket endpoints for accessing blockchain data from the Shred Explorer indexer database. It connects to the PostgreSQL database where the Indexer component stores the blockchain data.

## Features

- **WebSocket API**: Real-time updates when new blocks are added to the database
- **REST API**: Traditional HTTP endpoints for fetching block data and statistics
- **PostgreSQL Notifications**: Uses PostgreSQL LISTEN/NOTIFY to efficiently detect database changes
- **Real-time Updates**: Get notified immediately when new blockchain data is available
- **Fallback Polling**: Will automatically switch to polling if PostgreSQL notifications are not available
- **TypeScript**: Fully typed API with TypeScript for better developer experience
- **Request Validation**: Uses Zod for robust request validation in both REST and WebSocket APIs
- **Structured Logging**: Uses Pino for structured, level-based logging

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables by copying `.env.example` to `.env` and updating the values:
   ```bash
   cp .env.example .env
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```

## Development

Run in development mode with hot reloading:
```bash
npm run dev
```

> **Note**: The TypeScript build may show type errors during compilation due to Express router type definitions, but these errors are harmless and the resulting JavaScript code works correctly. We're ignoring these errors during the build process.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port for the REST API | `3001` |
| `WS_PORT` | WebSocket port | `3002` |
| `NODE_ENV` | Environment (development, production) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | |
| `DATABASE_HOST` | PostgreSQL host (used if URL not provided) | `localhost` |
| `DATABASE_PORT` | PostgreSQL port (used if URL not provided) | `5432` |
| `DATABASE_NAME` | PostgreSQL database name (used if URL not provided) | |
| `DATABASE_USER` | PostgreSQL username (used if URL not provided) | |
| `DATABASE_PASSWORD` | PostgreSQL password (used if URL not provided) | |
| `API_SECRET_KEY` | Secret key for API authentication | |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | `info` |
| `SKIP_DB_CHECK_HEALTH` | Skip DB check in health endpoint | `false` |

## API Security

This API is protected by an API key. All clients must include a valid API key in their requests:

- For REST API requests: Include the API key in the `X-API-Key` header
- For WebSocket connections: 
  - Option 1: Include the API key in the `X-API-Key` header (for clients that support custom headers)
  - Option 2: Include the API key in the WebSocket protocol as `api-key:YOUR_KEY` (for browsers that don't support custom headers)

The API key must be provided in the environment variables as `API_SECRET_KEY`. In development mode, if the API key is not set, the WebSocket server will allow all connections, but in production mode, it will reject them.

## API Endpoints

### REST API

All endpoints use Zod for request validation and return a standardized response format:

```typescript
// Success response
{
  "status": "success",
  "data": { /* response data */ }
}

// Error response
{
  "status": "error",
  "message": "Error message",
  "errors": [
    { "path": "field.name", "message": "Validation error message" }
  ]
}
```

Available endpoints:

- `GET /api/blocks/latest?limit=10&offset=0` - Get latest blocks
  - Query parameters:
    - `limit`: Number of blocks to return (default: 10, max: 100)
    - `offset`: Number of blocks to skip (default: 0)
  - Response
    - `blocks`: Array of block objects including their transaction hashes
    - `total`: Total number of blocks in the database

- `GET /api/blocks/:number` - Get a specific block by number
  - Path parameters:
    - `number`: Block number
  - Response
    - `block`: Block object including its transaction hashes

- `GET /api/stats` - Get latest statistics about the blockchain
  - Response
    - `latestBlock`: Latest block number
    - `latestTimestamp`: Timestamp of the latest block
    - `tps`: Transactions per second calculation
    - `transactionCount`: Transaction count of the last block
    - `gasPerSecond`: Gas per second calculation

- `GET /health` - Health check endpoint
  - Response
    - `status`: API status (ok or warning)
    - `timestamp`: Current timestamp
    - `database`: Database connection status
    - `version`: API version

### WebSocket API

Connect to the WebSocket server at `ws://localhost:3002` with your API key:

```javascript
// Using protocol for browsers
const ws = new WebSocket('ws://localhost:3002', ['api-key:your_secret_key_here']);

// Or with headers for Node.js clients
const ws = new WebSocket('ws://localhost:3002', {
  headers: {
    'X-API-Key': 'your_secret_key_here'
  }
});
```

The WebSocket API uses Zod for message validation and returns a standardized response format.

#### Client-to-Server Messages:

All messages are validated against a Zod schema. Invalid messages will be rejected with an error response.

```typescript
// Subscribe to a specific block
{
  type: "subscribeBlock",
  blockNumber: 12345
}

// Get latest blocks
{
  type: "getLatestBlocks",
  limit: 10  // optional, defaults to 10, max: 100
}

// Subscribe to all block updates
{
  type: "subscribe",
  channel: "blocks"
}

// Subscribe to a specific block
{
  type: "subscribe",
  channel: "block",
  slot: 12345
}
```

#### Server-to-Client Messages:

All server messages follow this format:

```typescript
{
  type: string;           // Message type
  status: "success" | "error";  // Status of the operation
  data: any;              // Response data
  timestamp: number;      // Server timestamp (milliseconds)
  message?: string;       // Optional message (mostly for errors)
}
```

##### Success Message Examples:

```typescript
// Block update notification
{
  type: "blockUpdate",
  status: "success",
  data: {
    number: 12345,
    hash: "0x...",
    parentHash: "0x...",
    timestamp: 1678912345,
    transactionCount: 150,
    transactions: [...]
  },
  timestamp: 1628097422000
}

// Latest blocks response
{
  type: "latestBlocks",
  status: "success",
  data: [
    // Array of block objects
  ],
  timestamp: 1628097422000
}

// Subscription confirmation
{
  type: "subscribed",
  status: "success",
  data: { channel: "blocks" },
  message: "Subscribed to block updates",
  timestamp: 1628097422000
}
```

##### Error Message Example:

```typescript
{
  type: "error",
  status: "error",
  message: "Validation failed",
  data: {
    errors: [
      { path: "blockNumber", message: "Expected number, received string" }
    ]
  },
  timestamp: 1628097422000
}
```

## Example Usage

The repository includes example TypeScript clients:

### WebSocket Client

```bash
npm run example:ws
```

### REST API Client

```bash
npm run example:rest
```

## Database Schema

See the `schema.md` file in the Indexer package for details on the database schema used by the API.

## Type Definitions

See `src/db/schema.ts` for the complete TypeScript type definitions of all data models.

## Important Note on Database Notifications

The API expects the Indexer to have created the necessary PostgreSQL notification triggers for real-time updates. If these triggers are not present, the API will fall back to polling the database for updates.