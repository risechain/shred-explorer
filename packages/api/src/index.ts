import dotenv from 'dotenv';
import { startApiServer } from './api/server';
import { createWebSocketServer } from './ws/server';
import { setupDatabaseListener, setupDatabaseTriggers } from './db/listener';
import { pool } from './db';

// Check for version flag
if (process.argv.includes('--version')) {
  console.log('Shred Explorer API v1.0.0');
  process.exit(0);
}

// Load environment variables
dotenv.config();

async function main() {
  try {
    console.log('Starting Shred Explorer API Server...');
    
    // Set up database triggers for notifications
    await setupDatabaseTriggers(pool);
    
    // Start API server
    startApiServer();
    
    // Create WebSocket server
    const { broadcastBlockUpdate } = createWebSocketServer();
    
    // Set up database listeners
    await setupDatabaseListener(async (blockNumber) => {
      // When a block is updated, broadcast it to all WebSocket clients
      await broadcastBlockUpdate(blockNumber);
    });
    
    console.log('All services started successfully');
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      await pool.end();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();