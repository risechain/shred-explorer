import WebSocket from 'ws';
import { logger } from '../utils/logger';

// Define message interfaces
interface StatsData {
  tps: number;
  shredInterval?: number;
  gasPerSecond: number;
  windowSize: number;
  lastUpdate?: number;
}

interface Block {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  transactionCount: number;
  transactions?: Transaction[];
}

interface Transaction {
  hash: string;
  from?: string;
  to?: string;
  value: string;
  transactionIndex: number;
}

interface ServerMessage {
  type: string;
  status: 'success' | 'error';
  data: any;
  timestamp?: number;
  message?: string;
}

// Get WebSocket URL from environment variables or use the deployed URL
// The WebSocket server is running on port 3002 (not at /ws path)
const WS_URL = process.env.WS_URL || 'wss://block-indexer-api.fly.dev:3002';

logger.info(`Connecting to WebSocket server at ${WS_URL}`);

// Connect to the WebSocket server
const ws = new WebSocket(WS_URL);

// Connection opened
ws.on('open', () => {
  logger.info('Connected to the WebSocket server');
  
  // Subscribe to block updates
  logger.info('Subscribing to block updates...');
  ws.send(JSON.stringify({ 
    type: 'subscribe', 
    channel: 'blocks' 
  }));
  
  // Subscribe to stats updates
  logger.info('Subscribing to stats updates...');
  ws.send(JSON.stringify({ 
    type: 'subscribe', 
    channel: 'stats' 
  }));
  
  // After 3 seconds, request latest blocks
  setTimeout(() => {
    logger.info('Requesting latest blocks...');
    ws.send(JSON.stringify({ 
      type: 'getLatestBlocks', 
      limit: 5 
    }));
  }, 3000);
});

// Listen for messages
ws.on('message', (data: WebSocket.RawData) => {
  try {
    const message: ServerMessage = JSON.parse(data.toString());
    
    logger.info(`Received ${message.type} message with status: ${message.status}`);
    
    if (message.status === 'error') {
      logger.error(`Error: ${message.message}`, message.data);
      return;
    }
    
    switch (message.type) {
      case 'blockUpdate':
        const block: Block = message.data;
        logger.info(`Block ${block.number} received with ${block.transactionCount} transactions`);
        logger.info(`Block hash: ${block.hash.substring(0, 10)}...`);
        break;
        
      case 'statsUpdate':
        const stats: StatsData = message.data;
        logger.info('Stats update received:');
        logger.info(`- TPS: ${stats.tps.toFixed(2)}`);
        logger.info(`- Gas/s: ${(stats.gasPerSecond / 1000000).toFixed(2)} MGas/s`);
        if (stats.shredInterval) {
          logger.info(`- Shred Interval: ${(stats.shredInterval * 1000).toFixed(2)} ms`);
        }
        break;
      
      case 'latestBlocks':
        const blocks: Block[] = message.data;
        logger.info(`Received ${blocks.length} latest blocks:`);
        blocks.forEach(block => {
          logger.info(`- Block ${block.number}: ${block.transactionCount} transactions`);
        });
        break;
        
      case 'subscribed':
        logger.info(`Successfully subscribed: ${message.message}`);
        break;
        
      default:
        logger.info('Unhandled message type:', message.type);
    }
  } catch (error) {
    logger.error('Error parsing message:', error);
  }
});

// Connection closed
ws.on('close', () => {
  logger.info('Disconnected from the WebSocket server');
});

// Connection error
ws.on('error', (error) => {
  logger.error('WebSocket error:', error);
});

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Closing WebSocket connection');
  ws.close();
  process.exit(0);
});

// Keep the process running
logger.info('WebSocket client is running. Press Ctrl+C to stop.');