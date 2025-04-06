import createPgListener from 'pg-listen';
import dotenv from 'dotenv';
import { db } from './index';
import { blocks } from './schema';
import { desc, eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { statsManager } from '../utils/stats';

// We won't use a strict interface for pg-listen since it doesn't have official types
// and the actual implementation has more methods and different return types

dotenv.config();

// Define the notification channel to match the indexer schema
const NEW_BLOCK_CHANNEL = 'new_block';

// Function to fetch the latest block details
export async function getBlockDetails(blockNumber: number) {
  logger.debug(`Fetching block details for block ${blockNumber}`);
  // Query the database for the specified block
  const blockData = await db.select().from(blocks).where(eq(blocks.number, blockNumber)).limit(1);
  return blockData[0] || null;
}

// Function to fetch the latest blocks
export async function getLatestBlocks(limit = 10) {
  logger.debug(`Fetching latest ${limit} blocks`);
  // Query the database for the latest blocks by number
  const latestBlocks = await db.select().from(blocks).orderBy(desc(blocks.number)).limit(limit);
  return latestBlocks;
}

// Function to fetch block data for stats calculation
export async function getBlockForStats(blockNumber: number) {
  logger.debug(`Fetching stats data for block ${blockNumber}`);
  const blockData = await db.select({
    number: blocks.number,
    timestamp: blocks.timestamp,
    transactionCount: blocks.transactionCount,
    gasUsed: blocks.gasUsed,
  })
  .from(blocks)
  .where(eq(blocks.number, blockNumber))
  .limit(1);
  
  return blockData[0] || null;
}

// Function to update stats when a new block is received
export async function updateStats(blockNumber: number) {
  try {
    logger.debug(`Updating stats with block ${blockNumber}`);
    
    // Get the block data needed for stats calculation
    const blockData = await getBlockForStats(blockNumber);
    
    if (!blockData) {
      logger.warn(`Block ${blockNumber} not found for stats update`);
      return;
    }
    
    // Add the block to the stats manager
    statsManager.addBlock(blockData);
    
    logger.debug(`Stats updated with block ${blockNumber}`);
  } catch (error) {
    logger.error(`Error updating stats with block ${blockNumber}:`, error);
  }
}

// Set up the notification listener
export async function setupDatabaseListener(onBlockChange: (blockNumber: number) => void) {
  try {
    // Initialize stats manager with recent blocks
    await statsManager.initialize();
    
    // Check if pg-listen is available
    let listener;
    try {
      // Create a pg_listen instance using either DATABASE_URL or individual connection parameters
      if (process.env.DATABASE_URL) {
        listener = createPgListener({
          connectionString: process.env.DATABASE_URL,
        });
        logger.info('Using DATABASE_URL for pg-listen connection');
      } else {
        // Construct connection config from individual parameters
        listener = createPgListener({
          host: process.env.DATABASE_HOST || 'localhost',
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USER,
          password: process.env.DATABASE_PASSWORD,
        });
        logger.info('Using individual connection parameters for pg-listen connection');
      }

      // Connect to PostgreSQL
      await listener.connect();
      logger.info('Connected to PostgreSQL for notifications');

      // Listen for block updates using the new_block channel
      await listener.listenTo(NEW_BLOCK_CHANNEL);

      // Handle notifications
      listener.notifications.on(NEW_BLOCK_CHANNEL, async (payload: any) => {
        if (!payload || typeof payload !== 'object') {
          logger.warn(`Received invalid notification payload: ${JSON.stringify(payload)}`);
          return;
        }
        
        const blockNumber = Number(payload.number);
        if (isNaN(blockNumber)) {
          logger.warn(`Received notification with invalid block number: ${JSON.stringify(payload)}`);
          return;
        }
        
        // logger.info(`New block notification received for block ${blockNumber}`);
        logger.debug(`Block notification payload: ${JSON.stringify(payload)}`);
        
        // Update stats with the new block
        await updateStats(blockNumber);
        
        // Notify other components about the block change
        onBlockChange(blockNumber);
      });

      // Handle connection errors
      listener.events.on('error', (error: Error) => {
        logger.error('Database notification error:', error);
      });
    } catch (err) {
      logger.error('Error setting up pg-listen:', err);
      logger.info('Will fall back to polling for block updates');
      
      // Set up a fallback polling mechanism
      setInterval(async () => {
        try {
          const latestBlocks = await getLatestBlocks(1);
          if (latestBlocks && latestBlocks.length > 0) {
            const blockNumber = latestBlocks[0].number;
            
            // Update stats with the latest block
            await updateStats(blockNumber);
            
            // Notify other components
            onBlockChange(blockNumber);
          }
        } catch (pollError) {
          logger.error('Error polling for blocks:', pollError);
        }
      }, 5000); // Poll every 5 seconds
    }

    return listener;
  } catch (error) {
    logger.error('Failed to set up database listener:', error);
    throw error;
  }
}

// Function to verify the PostgreSQL notification trigger exists
export async function verifyDatabaseTrigger(pool: any) {
  try {
    logger.info('Verifying database trigger for notifications');
    // Check if the trigger created by the indexer exists
    const triggerCheck = await pool.query(`
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'block_insert_trigger'
    `);

    if (triggerCheck.rows.length === 0) {
      logger.warn('The expected block_insert_trigger does not exist in the database');
      logger.info('Please ensure the indexer has properly set up the notification trigger');
      return false;
    } else {
      logger.info('Database trigger for block notifications exists');
      return true;
    }
  } catch (error) {
    logger.error('Failed to verify database trigger:', error);
    return false;
  }
}