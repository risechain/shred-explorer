import { db } from './db';
import { blocks } from './db/schema';
import { desc } from 'drizzle-orm';

async function testStats() {
  try {
    // Get the latest block data
    const latestBlockQuery = await db.select({
      number: blocks.number,
      timestamp: blocks.timestamp,
      shredCount: blocks.shredCount,
      transactionCount: blocks.transactionCount,
      avgTps: blocks.avgTps,
      avgShredInterval: blocks.avgShredInterval
    })
    .from(blocks)
    .orderBy(desc(blocks.number))
    .limit(1);
    
    const latestBlock = latestBlockQuery.length > 0 ? latestBlockQuery[0] : null;
    
    console.log("Latest block data:", latestBlock);
    
    // Prepare the result in the requested format
    const result = {
      last_update: latestBlock ? new Date(latestBlock.timestamp).getTime() : 0, // timestamp in milliseconds
      block_height: latestBlock ? latestBlock.number : 0,
      shreds_per_block: latestBlock ? latestBlock.shredCount : 0,
      transactions_per_block: latestBlock ? latestBlock.transactionCount : 0,
      avg_tps: latestBlock ? latestBlock.avgTps || 0 : 0,
      avg_shred_interval: latestBlock ? latestBlock.avgShredInterval || 0 : 0
    };
    
    console.log("Formatted result:", result);
  } catch (error) {
    console.error('Error testing stats:', error);
  } finally {
    process.exit(0);
  }
}

testStats();