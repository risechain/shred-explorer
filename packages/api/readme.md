# Shred Explorer API Server

The API server provides both REST and WebSocket endpoints for accessing the Shred Explorer data. It connects to the PostgreSQL database where the ETL component stores the blockchain data.

## Features

- **WebSocket API**: Real-time updates when new blocks are added or updated
- **REST API**: Traditional HTTP endpoints for fetching block and shred data
- **PostgreSQL Notifications**: Uses PostgreSQL LISTEN/NOTIFY to efficiently detect database changes
- **Real-time Updates**: Get notified immediately when new blockchain data is available
- **Fallback Polling**: Will automatically switch to polling if PostgreSQL notifications are not available
- **TypeScript**: Fully typed API with TypeScript for better developer experience
- **Request Validation**: Uses Zod for robust request validation in both REST and WebSocket APIs

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

- `GET /api/blocks/:number` - Get a specific block by number
  - Path parameters:
    - `number`: Block number (slot)

- `GET /api/blocks/:number/shreds?limit=10&offset=0` - Get all shreds for a specific block
  - Path parameters:
    - `number`: Block number (slot)
  - Query parameters:
    - `limit`: Number of shreds to return (default: 10, max: 100)
    - `offset`: Number of shreds to skip (default: 0)

- `GET /api/stats` - Get overall statistics

### WebSocket API

Connect to the WebSocket server at `ws://localhost:3001/ws`

The WebSocket API uses Zod for message validation and returns a standardized response format.

#### Client-to-Server Messages:

All messages are validated against a Zod schema. Invalid messages will be rejected with an error response.

```typescript
// Subscribe to a specific block
{
  type: "subscribeBlock",
  blockNumber: 12345  // or slot: 12345
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
    timestamp: "2023-08-04T12:30:45Z",
    transactionCount: 150,
    shredCount: 8,
    stateChangeCount: 200,
    avgTps: 123.45,
    avgShredInterval: 45.67
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

The API provides access to the following data:

- **Blocks**: Aggregated information about each block including performance metrics
- **Shreds**: Individual shreds that make up blocks
- **Transactions**: Transaction details contained within shreds
- **State Changes**: State changes that occurred in transactions

## Type Definitions

See `src/db/schema.ts` for the complete TypeScript type definitions of all data models.

## Database Triggers

The server automatically creates the necessary PostgreSQL triggers and functions to get notifications when blocks are added or updated. This happens during server startup.