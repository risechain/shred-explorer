import StatsManager from '../../src/utils/stats';
import { BlockStats } from '../../src/db/schema';

// Mock the database and logger
jest.mock('../../src/db', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('StatsManager', () => {
  let statsManager: StatsManager;

  beforeEach(() => {
    statsManager = new StatsManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('window size management', () => {
    it('should initialize with the fixed window size', () => {
      expect(statsManager.getStatsWindowSize()).toBe(10);
    });
  });

  describe('stats calculation', () => {
    it('should return null if no blocks are in cache', () => {
      expect(statsManager.getStats()).toBeNull();
    });

    it('should calculate stats with a single block', () => {
      const block = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 150,
        gasUsed: 5000000,
      };
      
      statsManager.addBlock(block);
      
      const stats = statsManager.getStats();
      expect(stats).not.toBeNull();
      
      // Using default block time of 12 seconds for single block calculation
      expect(stats?.tps).toBeCloseTo(150 / 12, 1);
      expect(stats?.gasPerSecond).toBeCloseTo(5000000 / 12, 1);
      expect(stats?.shredInterval).toBeDefined();
    });

    it('should calculate stats properly with multiple blocks', () => {
      const block1 = {
        number: 100,
        timestamp: 1616451600, // Base time
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      const block2 = {
        number: 101,
        timestamp: 1616451612, // 12 seconds later
        transactionCount: 150,
        gasUsed: 5000000,
      };
      
      const block3 = {
        number: 102,
        timestamp: 1616451624, // 24 seconds from start
        transactionCount: 180,
        gasUsed: 6000000,
      };
      
      statsManager.addBlock(block1);
      statsManager.addBlock(block2);
      statsManager.addBlock(block3);
      
      const stats = statsManager.getStats();
      expect(stats).not.toBeNull();
      
      // Stats should be defined
      expect(stats).not.toBeNull();
      
      // TPS should be total transactions / total time span
      const timeSpanSeconds = (block3.timestamp - block1.timestamp) / 1000; // 24 seconds
      const expectedTPS = (120 + 150 + 180) / timeSpanSeconds;
      expect(stats?.tps).toBeCloseTo(expectedTPS, 1);
      
      // Gas/s should be total gas / total time span
      const expectedGasPerSecond = (4000000 + 5000000 + 6000000) / timeSpanSeconds;
      expect(stats?.gasPerSecond).toBeCloseTo(expectedGasPerSecond, 1);
      
      // Shred interval in the code is calculated as seconds per transaction
      const expectedShredInterval = timeSpanSeconds / (120 + 150 + 180);
      expect(stats?.shredInterval).toBeCloseTo(expectedShredInterval, 1);
    });

    it('should handle blocks added out of order', () => {
      const block1 = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      const block3 = {
        number: 102,
        timestamp: 1616451624,
        transactionCount: 180,
        gasUsed: 6000000,
      };
      
      const block2 = {
        number: 101,
        timestamp: 1616451612,
        transactionCount: 150,
        gasUsed: 5000000,
      };
      
      // Add blocks in non-sequential order
      statsManager.addBlock(block1);
      statsManager.addBlock(block3);
      statsManager.addBlock(block2);
      
      const stats = statsManager.getStats();
      
      // Stats should be defined
      expect(stats).not.toBeNull();
      
      // Time calculations should be based on correct first and last blocks
      const timeSpanSeconds = (block3.timestamp - block1.timestamp) / 1000;
      const expectedTPS = (120 + 150 + 180) / timeSpanSeconds;
      expect(stats?.tps).toBeCloseTo(expectedTPS, 1);
    });

    it('should handle invalid time spans by using fallback calculations', () => {
      // Use a single block to test fallback calculation
      const block1 = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      statsManager.addBlock(block1);
      
      const stats = statsManager.getStats();
      
      // Stats should be defined
      expect(stats).not.toBeNull();
      
      // Should use fallback formula with default block time
      expect(stats?.tps).toBeCloseTo(120 / 12, 1); // Using default block time for single block
    });

    it('should limit blocks to window size', () => {
      // Create a manager with the default window size
      const manager = new StatsManager();
      
      const block1 = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      const block2 = {
        number: 101,
        timestamp: 1616451612,
        transactionCount: 150,
        gasUsed: 5000000,
      };
      
      const block3 = {
        number: 102,
        timestamp: 1616451624,
        transactionCount: 180,
        gasUsed: 6000000,
      };
      
      // Add all three blocks
      manager.addBlock(block1);
      manager.addBlock(block2);
      manager.addBlock(block3);
      
      const stats = manager.getStats();
      
      // Stats should be defined
      expect(stats).not.toBeNull();
      
      // Time calculations should only use the blocks in window
      const timeSpanSeconds = (block3.timestamp - block2.timestamp) / 1000;
      const expectedTPS = (150 + 180) / timeSpanSeconds;
      expect(stats?.tps).toBeCloseTo(expectedTPS, 1);
    });
  });

  describe('stats caching', () => {
    it('should cache stats after calculation', () => {
      const block = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      // Add a block, which triggers stats calculation
      statsManager.addBlock(block);
      
      // Spy on the recalculateStats private method
      const recalculateStatsSpy = jest.spyOn(statsManager as any, 'recalculateStats');
      
      // Get stats should use cached value
      statsManager.getStats();
      
      // recalculateStats should not be called again
      expect(recalculateStatsSpy).not.toHaveBeenCalled();
    });

    it('should cache stats after add block', () => {
      const block = {
        number: 100,
        timestamp: 1616451600,
        transactionCount: 120,
        gasUsed: 4000000,
      };
      
      // Add a block
      statsManager.addBlock(block);
      
      // Spy on the recalculateStats private method
      const recalculateStatsSpy = jest.spyOn(statsManager as any, 'recalculateStats');
      
      // Getting stats after adding a block should not trigger recalculation again
      statsManager.getStats();
      expect(recalculateStatsSpy).not.toHaveBeenCalled();
    });
  });
});