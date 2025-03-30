import createPgListener from 'pg-listen';
import dotenv from 'dotenv';
import { db } from './index';
import { blocks } from './schema';
import { eq } from 'drizzle-orm';

// We won't use a strict interface for pg-listen since it doesn't have official types
// and the actual implementation has more methods and different return types

dotenv.config();

// Define the notification channels
const BLOCK_UPDATED_CHANNEL = 'block_updated';
const BLOCK_CREATED_CHANNEL = 'block_created';

// Function to fetch the latest block details
export async function getBlockDetails(blockNumber: number) {
  // Query the database for the specified block
  const blockData = await db.select().from(blocks).where(eq(blocks.number, blockNumber)).limit(1);
  return blockData[0] || null;
}

// Function to fetch the latest blocks
export async function getLatestBlocks(limit = 10) {
  // Query the database for the latest blocks by timestamp
  const latestBlocks = await db.select().from(blocks).orderBy(blocks.timestamp).limit(limit);
  return latestBlocks;
}

// Set up the notification listener
export async function setupDatabaseListener(onBlockChange: (blockNumber: number) => void) {
  try {
    // Check if pg-listen is available
    let listener;
    try {
      // Create a pg_listen instance
      listener = createPgListener({
        connectionString: process.env.DATABASE_URL,
      });

      // Connect to PostgreSQL
      await listener.connect();
      console.log('Connected to PostgreSQL for notifications');

      // Listen for block updates
      await listener.listenTo(BLOCK_UPDATED_CHANNEL);
      await listener.listenTo(BLOCK_CREATED_CHANNEL);

      // Handle notifications
      listener.notifications.on(BLOCK_UPDATED_CHANNEL, (payload: any) => {
        const blockNumber = Number(payload.blockNumber);
        console.log(`Block ${blockNumber} updated`);
        onBlockChange(blockNumber);
      });

      listener.notifications.on(BLOCK_CREATED_CHANNEL, (payload: any) => {
        const blockNumber = Number(payload.blockNumber);
        console.log(`Block ${blockNumber} created`);
        onBlockChange(blockNumber);
      });

      // Handle connection errors
      listener.events.on('error', (error: Error) => {
        console.error('Database notification error:', error);
      });
    } catch (err) {
      console.error('Error setting up pg-listen:', err);
      console.log('Will fall back to polling for block updates');
      
      // Set up a fallback polling mechanism
      setInterval(async () => {
        try {
          const latestBlocks = await getLatestBlocks(1);
          if (latestBlocks && latestBlocks.length > 0) {
            onBlockChange(latestBlocks[0].number);
          }
        } catch (pollError) {
          console.error('Error polling for blocks:', pollError);
        }
      }, 5000); // Poll every 5 seconds
    }

    return listener;
  } catch (error) {
    console.error('Failed to set up database listener:', error);
    throw error;
  }
}

// Function to create the necessary triggers in PostgreSQL
export async function setupDatabaseTriggers(pool: any) {
  try {
    // Create function to notify clients of block updates
    await pool.query(`
      CREATE OR REPLACE FUNCTION notify_block_change()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM pg_notify('block_created', json_build_object('blockNumber', NEW.number)::text);
        ELSIF TG_OP = 'UPDATE' THEN
          PERFORM pg_notify('block_updated', json_build_object('blockNumber', NEW.number)::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Check if trigger already exists before creating
    const triggerCheck = await pool.query(`
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'block_change_trigger'
    `);

    if (triggerCheck.rows.length === 0) {
      // Create trigger on blocks table
      await pool.query(`
        CREATE TRIGGER block_change_trigger
        AFTER INSERT OR UPDATE ON blocks
        FOR EACH ROW
        EXECUTE FUNCTION notify_block_change();
      `);
      console.log('Created database triggers for block notifications');
    } else {
      console.log('Database triggers already exist');
    }
  } catch (error) {
    console.error('Failed to setup database triggers:', error);
    throw error;
  }
}