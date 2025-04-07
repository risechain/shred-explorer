# Shred Explorer API Documentation

This document provides comprehensive documentation for the Shred Explorer API, including endpoints, request/response formats, authentication, and WebSocket functionality.

## Table of Contents

1. [Authentication](#authentication)
2. [REST API Endpoints](#rest-api-endpoints)
3. [WebSocket API](#websocket-api)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)

## Authentication

The API uses an API key authentication system.

```
x-api-key: YOUR_API_KEY
```

All requests (except for the health check endpoint) require an API key to be included in the header. If the API key is missing or invalid, a 403 Forbidden response will be returned.

## REST API Endpoints

### Health Check

```
GET /api/health
```

Checks if the API service is running correctly.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-04-07T12:00:00.000Z",
  "database": "connected",
  "version": "1.0.0"
}
```

### Get Latest Blocks

```
GET /api/blocks/latest
```

Returns the most recent blocks from the blockchain.

**Query Parameters**:
- `limit` (optional, default: 10, max: 100): Number of blocks to return
- `offset` (optional, default: 0): Number of blocks to skip

**Response**:
```json
{
  "status": "success",
  "data": {
    "blocks": [
      {
        "number": 12345,
        "hash": "0x...",
        "parentHash": "0x...",
        "timestamp": 1712345678,
        "transactionCount": 42,
        "transactions": [...]
      },
      ...
    ],
    "total": 50000
  }
}
```

### Get Block by Number

```
GET /api/blocks/:number
```

Returns detailed information about a specific block.

**URL Parameters**:
- `number`: The block number to retrieve

**Response**:
```json
{
  "status": "success",
  "data": {
    "block": {
      "number": 12345,
      "hash": "0x...",
      "parentHash": "0x...",
      "timestamp": 1712345678,
      "transactionsRoot": "0x...",
      "stateRoot": "0x...",
      "receiptsRoot": "0x...",
      "gasUsed": 1000000,
      "gasLimit": 30000000,
      "baseFeePerGas": 100000,
      "extraData": "0x...",
      "miner": "0x...",
      "difficulty": "0",
      "totalDifficulty": "0",
      "size": 1234,
      "transactionCount": 42,
      "transactions": [
        {
          "hash": "0x...",
          "from": "0x...",
          "to": "0x...",
          "value": "1000000000000000000",
          "transactionIndex": 0
        },
        ...
      ],
      "createdAt": "2025-04-07T12:00:00.000Z",
      "updatedAt": "2025-04-07T12:00:00.000Z"
    }
  }
}
```

### Get Chain Statistics

```
GET /api/stats
```

Returns real-time statistics about the blockchain.

**Response**:
```json
{
  "status": "success",
  "data": {
    "tps": 12.5,
    "shredInterval": 0.08,
    "gasPerSecond": 5000000,
    "windowSize": 10
  }
}
```

## WebSocket API

The WebSocket API allows for real-time updates and subscriptions to blockchain data.

### Connection

```
ws://your-api-domain:3002
```

Upon connection, the server sends the latest 10 blocks and current statistics.

### Client Messages

#### Subscribe to All Block Updates

```json
{
  "type": "subscribe",
  "channel": "blocks"
}
```

#### Subscribe to Specific Block Updates

```json
{
  "type": "subscribeBlock",
  "blockNumber": 12345
}
```

Or using slot number:

```json
{
  "type": "subscribeBlock",
  "slot": 12345
}
```

#### Subscribe to Statistics Updates

```json
{
  "type": "subscribe",
  "channel": "stats"
}
```

#### Request Latest Blocks

```json
{
  "type": "getLatestBlocks",
  "limit": 20
}
```

#### Request Current Stats

```json
{
  "type": "getStats"
}
```

### Server Messages

#### Block Update

```json
{
  "type": "blockUpdate",
  "status": "success",
  "data": {
    // Block details
  },
  "timestamp": 1712345678000
}
```

#### Statistics Update

```json
{
  "type": "statsUpdate",
  "status": "success",
  "data": {
    "tps": 12.5,
    "shredInterval": 0.08,
    "gasPerSecond": 5000000,
    "windowSize": 10
  },
  "timestamp": 1712345678000
}
```

#### Error Response

```json
{
  "type": "error",
  "status": "error",
  "message": "Error message",
  "data": {
    "errors": [
      {
        "path": "field.name",
        "message": "Validation error message"
      }
    ]
  },
  "timestamp": 1712345678000
}
```

## Data Models

### Block

| Field            | Type      | Description                                   |
|------------------|-----------|-----------------------------------------------|
| number           | number    | Block number                                  |
| hash             | string    | Block hash (hex)                              |
| parentHash       | string    | Parent block hash (hex)                       |
| timestamp        | number    | Unix timestamp (in seconds)                   |
| transactionsRoot | string    | Merkle root of transaction trie (hex)         |
| stateRoot        | string    | Root of state trie (hex)                      |
| receiptsRoot     | string    | Root of receipts trie (hex)                   |
| gasUsed          | number    | Total gas used by all transactions            |
| gasLimit         | number    | Maximum gas allowed in this block             |
| baseFeePerGas    | number    | Base fee per gas in this block (optional)     |
| extraData        | string    | Extra data field (hex)                        |
| miner            | string    | Address of miner/validator (hex)              |
| difficulty       | string    | Block difficulty                              |
| totalDifficulty  | string    | Total chain difficulty up to this block       |
| size             | number    | Block size in bytes                           |
| transactionCount | number    | Number of transactions in the block           |
| transactions     | array     | List of transaction objects (optional)        |
| createdAt        | timestamp | When this block was indexed                   |
| updatedAt        | timestamp | When this block was last updated              |

### Transaction

| Field            | Type   | Description                               |
|------------------|--------|-------------------------------------------|
| hash             | string | Transaction hash (hex)                    |
| from             | string | Sender address (hex) (optional)           |
| to               | string | Recipient address (hex) (optional)        |
| value            | string | Amount transferred (in wei) (optional)    |
| transactionIndex | number | Index position in the block (optional)    |

### Statistics

| Field          | Type   | Description                                |
|----------------|--------|--------------------------------------------|
| tps            | number | Transactions per second                    |
| shredInterval  | number | Average time (ms) per transaction          |
| gasPerSecond   | number | Average gas used per second                |
| windowSize     | number | Number of blocks used for calculation      |

## Error Handling

All API endpoints follow a consistent error response format:

```json
{
  "status": "error",
  "message": "Error description",
  "errors": [
    {
      "path": "field.path",
      "message": "Detailed error message"
    }
  ]
}
```

### Common HTTP Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `403 Forbidden`: Invalid or missing API key
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error