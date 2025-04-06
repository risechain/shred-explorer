import { blocks, BlockStats } from '../db/schema';
import { db } from '../db';
import { desc } from 'drizzle-orm';
import { logger } from './logger';

// Block data needed for stats calculation
interface BlockStatsData {
  number: number;
  timestamp: number;
  transactionCount: number;
  gasUsed: number;
}

// Stats cache configuration - how many recent blocks to track for stats
const STATS_WINDOW_SIZE = 10;

// Cached blocks for stats calculation
class StatsManager {
  private recentBlocks: BlockStatsData[] = [];
  private readonly statsWindowSize: number = STATS_WINDOW_SIZE;
  private cachedStats: BlockStats | null = null;
  private statsNeedRecalculation: boolean = true;

  constructor() {
    logger.info(`Stats manager initialized with fixed window size of ${this.statsWindowSize} blocks`);
  }

  // Get the window size
  getStatsWindowSize(): number {
    return this.statsWindowSize;
  }

  // Add a new block to the cache, trim if needed, and recalculate stats
  addBlock(block: BlockStatsData) {
    // Add new block to the end
    this.recentBlocks.push(block);
    
    // Keep only the most recent blocks based on fixed window size
    if (this.recentBlocks.length > this.statsWindowSize) {
      this.recentBlocks = this.recentBlocks.slice(-this.statsWindowSize);
    }
    
    logger.debug(`Added block ${block.number} to stats cache, now tracking ${this.recentBlocks.length} blocks`);
    
    // Recalculate stats immediately with the new block
    this.recalculateStats();
  }

  // Get the current stats (returns cached value unless recalculation is needed)
  getStats(): BlockStats | null {
    // Recalculate only if needed
    if (this.statsNeedRecalculation) {
      this.recalculateStats();
    }
    
    return this.cachedStats;
  }

  // Force recalculation of stats
  private recalculateStats() {
    if (this.recentBlocks.length === 0) {
      logger.warn('No blocks in stats cache for recalculation');
      this.cachedStats = null;
      this.statsNeedRecalculation = false;
      return;
    }

    // Sort blocks by number to ensure they're in the right order
    const sortedBlocks = [...this.recentBlocks].sort((a, b) => a.number - b.number);
    
    // Get latest block
    const latestBlock = sortedBlocks[sortedBlocks.length - 1];
    
    // For calculation, we need at least 2 blocks
    if (sortedBlocks.length < 2) {
      logger.debug('Only one block in cache, using simplified stats calculation');
      // If we only have one block, use a simplified calculation
      const blockTimeSeconds = 12; // Assuming average block time
      this.cachedStats = {
        tps: Number((latestBlock.transactionCount / blockTimeSeconds).toFixed(2)),
        gasPerSecond: Number((latestBlock.gasUsed / blockTimeSeconds).toFixed(2)),
        shredInterval: 1 / (latestBlock.transactionCount || 1), // Avoid division by zero
      };
      this.statsNeedRecalculation = false;
      return;
    }

    // Calculate time difference between first and last block
    const firstBlock = sortedBlocks[0];
    const timeSpanSeconds = (latestBlock.timestamp - firstBlock.timestamp);

    // Calculate total transactions and gas used in this window
    const totalTransactions = sortedBlocks.reduce((sum, block) => sum + block.transactionCount, 0);
    const totalGasUsed = sortedBlocks.reduce((sum, block) => sum + block.gasUsed, 0);

    // Calculate TPS and gas/s
    const tps = Number((totalTransactions / timeSpanSeconds).toFixed(2));
    const gasPerSecond = Number((totalGasUsed / timeSpanSeconds).toFixed(2));
    const shredInterval = Number((timeSpanSeconds / (totalTransactions || 1)).toFixed(4));

    // Calculate shred interval (average time per transaction)
    logger.debug(`Calculated stats over ${sortedBlocks.length} blocks spanning ${timeSpanSeconds} seconds`);
    
    this.cachedStats = {
      tps,
      gasPerSecond,
      shredInterval,
    };
    
    this.statsNeedRecalculation = false;
  }

  // Initialize with the most recent blocks from the database
  async initialize() {
    try {
      logger.info(`Initializing stats manager with fixed window size of ${this.statsWindowSize} blocks`);
      
      const latestBlocks = await db.select({
        number: blocks.number,
        timestamp: blocks.timestamp,
        transactionCount: blocks.transactionCount,
        gasUsed: blocks.gasUsed,
      })
      .from(blocks)
      .orderBy(desc(blocks.number))
      .limit(this.statsWindowSize);
      
      // Clear and refill the cache
      this.recentBlocks = [];
      
      // Add blocks in chronological order (but without recalculating each time)
      if (latestBlocks.length > 0) {
        // Add all blocks except the last one without recalculation
        const blocksToAdd = latestBlocks.slice(1).reverse();
        for (const block of blocksToAdd) {
          this.recentBlocks.push(block);
        }
        
        // Flag that we need recalculation
        this.statsNeedRecalculation = true;
        
        // Add the last block with recalculation
        this.addBlock(latestBlocks[0]);
      }
      
      logger.info(`Stats manager initialized with ${this.recentBlocks.length} blocks`);
    } catch (error) {
      logger.error('Failed to initialize stats manager:', error);
    }
  }
}

// Create and export a singleton instance
export const statsManager = new StatsManager();

// Also export the class for testing
export default StatsManager;