import express from 'express';
import { db } from '../db';
import { blocks, BlockStats } from '../db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { validate } from './middleware/validate';
import { blockNumberSchema, paginationSchema } from './schemas';
import { logger } from '../utils/logger';
import { statsManager } from '../utils/stats';
import { cacheMiddleware } from '../utils/cache';

const router = express.Router();

// Get latest blocks
router.get('/blocks/latest', 
  validate(paginationSchema, 'query'),
  cacheMiddleware(),
  async (req, res) => {
    try {
      // @ts-ignore
      const limit = req.query.limit as number;
      // @ts-ignore
      const offset = req.query.offset as number;
      
      logger.info(`Fetching latest blocks with limit ${limit} and offset ${offset}`);
      
      // Get total block count
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(blocks);
      
      // Get latest blocks
      const latestBlocks = await db.select({
        number: blocks.number,
        hash: blocks.hash,
        parentHash: blocks.parentHash,
        timestamp: blocks.timestamp,
        transactionCount: blocks.transactionCount,
        transactions: blocks.transactions,
      })
        .from(blocks)
        .orderBy(desc(blocks.number))
        .limit(limit)
        .offset(offset);
        
      logger.info(`Found ${latestBlocks.length} blocks`);
      
      res.json({
        status: 'success',
        data: {
          blocks: latestBlocks,
          total
        }
      });
    } catch (error) {
      logger.error('Error fetching latest blocks:', error);
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
  cacheMiddleware(),
  async (req, res) => {
    try {
      const blockNumber = req.params.number as unknown as number;
      
      logger.info(`Fetching block ${blockNumber}`);
      
      const blockData = await db.select()
        .from(blocks)
        .where(eq(blocks.number, blockNumber))
        .limit(1);
        
      if (blockData.length === 0) {
        logger.warn(`Block ${blockNumber} not found`);
        return res.status(404).json({ 
          status: 'error',
          message: 'Block not found' 
        });
      }
      
      logger.info(`Successfully retrieved block ${blockNumber}`);
      
      res.json({
        status: 'success',
        data: {
          block: blockData[0]
        }
      });
    } catch (error) {
      logger.error(`Error fetching block ${req.params.number}:`, error);
      res.status(500).json({ 
        status: 'error',
        message: 'Internal server error' 
      });
    }
  }
);

// Get statistics
router.get('/stats', cacheMiddleware(), async (req, res) => {
  try {
    logger.info('Fetching chain statistics');
    
    // Get pre-calculated stats from our stats manager
    const stats = statsManager.getStats();
    
    if (!stats) {
      logger.warn('No stats available');
      return res.status(404).json({
        status: 'error',
        message: 'No blocks found to calculate statistics'
      });
    }
    
    logger.info('Successfully retrieved chain statistics');
    
    // Include fixed window size in the response
    res.json({
      status: 'success',
      data: {
        ...stats,
        windowSize: statsManager.getStatsWindowSize()
      }
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

export default router;