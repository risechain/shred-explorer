import express from 'express';
import { db } from '../db';
import { blocks, shreds } from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { validate } from './middleware/validate';
import { blockNumberSchema, paginationSchema } from './schemas';

const router = express.Router();

// Get latest blocks
router.get('/blocks/latest', 
  validate(paginationSchema, 'query'),
  async (req, res) => {
    try {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 0;
      const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
      
      const latestBlocks = await db.select()
        .from(blocks)
        .orderBy(desc(blocks.number))
        .limit(limit)
        .offset(offset);
        
      res.json(latestBlocks);
    } catch (error) {
      console.error('Error fetching latest blocks:', error);
      res.status(500).json({ 
        status: 'error',
        message: 'Internal server error' 
      });
    }
  }
);

// Get block by number
router.get('/blocks/:number', 
  validate(blockNumberSchema, 'params'),
  async (req, res) => {
    try {
      const blockNumber = req.params.number as unknown as number;
      
      const blockData = await db.select()
        .from(blocks)
        .where(eq(blocks.number, blockNumber))
        .limit(1);
        
      if (blockData.length === 0) {
        return res.status(404).json({ 
          status: 'error',
          message: 'Block not found' 
        });
      }
      
      res.json({
        status: 'success',
        data: blockData[0]
      });
    } catch (error) {
      console.error('Error fetching block:', error);
      res.status(500).json({ 
        status: 'error',
        message: 'Internal server error' 
      });
    }
  }
);

// Get shreds for a block
router.get('/blocks/:number/shreds', 
  validate(blockNumberSchema, 'params'),
  validate(paginationSchema, 'query'),
  async (req, res) => {
    try {
      const blockNumber = req.params.number as unknown as number;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 0;
      const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
      
      const shredData = await db.select()
        .from(shreds)
        .where(eq(shreds.blockNumber, blockNumber))
        .orderBy(shreds.shredIdx)
        .limit(limit)
        .offset(offset);
        
      res.json({
        status: 'success',
        data: shredData
      });
    } catch (error) {
      console.error('Error fetching shreds:', error);
      res.status(500).json({ 
        status: 'error',
        message: 'Internal server error' 
      });
    }
  }
);

// Get statistics
router.get('/stats', async (req, res) => {
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
    
    // Prepare the result in the requested format
    const result = {
      last_update: latestBlock ? new Date(latestBlock.timestamp).getTime() : 0, // timestamp in milliseconds
      block_height: latestBlock ? latestBlock.number : 0,
      shreds_per_block: latestBlock ? latestBlock.shredCount : 0,
      transactions_per_block: latestBlock ? latestBlock.transactionCount : 0,
      avg_tps: latestBlock ? latestBlock.avgTps || 0 : 0,
      avg_shred_interval: latestBlock ? latestBlock.avgShredInterval || 0 : 0
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

export default router;