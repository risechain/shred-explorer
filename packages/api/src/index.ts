import dotenv from 'dotenv';
import { startApiServer } from './api/server';
import { createWebSocketServer } from './ws/server';
import { setupDatabaseListener, verifyDatabaseTrigger } from './db/listener';
import { pool } from './db';
import { logger } from './utils/logger';

// Check for version flag
if (process.argv.includes('--version')) {
  console.log('Shred Explorer API v1.0.0');
  process.exit(0);
}

// Load environment variables
dotenv.config();

async function main() {
  try {
    logger.info('Starting Shred Explorer API Server...');
    
    // Test database connection
    try {
      const client = await pool.connect();
      logger.info('Successfully connected to database');
      client.release();
    } catch (dbError) {
      logger.error('Database connection failed:', dbError);
      throw dbError;
    }
    
    // Verify database triggers for notifications exist
    try {
      const triggerExists = await verifyDatabaseTrigger(pool);
      if (!triggerExists) {
        logger.warn('Database notification trigger not found. Real-time updates may not work properly.');
        logger.info('Please ensure the indexer is running and has created the necessary PostgreSQL triggers.');
      }
    } catch (triggerError) {
      logger.error('Failed to verify database triggers, continuing anyway:', triggerError);
      // Continue execution even if verification fails
    }
    
    // Start API server
    startApiServer();
    
    // Create WebSocket server
    const { broadcastBlockUpdate } = createWebSocketServer();
    
    // Set up database listeners
    await setupDatabaseListener(async (blockNumber) => {
      // When a block is updated, broadcast it to all WebSocket clients
      await broadcastBlockUpdate(blockNumber);
    });
    
    logger.info('All services started successfully');
    
    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await pool.end();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();