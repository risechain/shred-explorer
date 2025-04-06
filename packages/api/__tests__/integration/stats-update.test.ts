import { updateStats } from '../../src/db/listener';
import { statsManager } from '../../src/utils/stats';

// Mock dependencies
jest.mock('../../src/db', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
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

// Create a mock for the real statsManager
jest.mock('../../src/utils/stats', () => ({
  statsManager: {
    addBlock: jest.fn(),
    getStats: jest.fn(),
    getStatsWindowSize: jest.fn().mockReturnValue(10),
  }
}));

describe('Stats Update Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateStats function', () => {
    it('should fetch block data and update stats manager', async () => {
      // Mock the getBlockForStats implementation
      const mockBlock = {
        number: 1000,
        timestamp: 1616451600,
        transactionCount: 150,
        gasUsed: 5000000
      };
      
      // Mock db.select().from().where().limit() to return the mock block
      const mockDb = require('../../src/db').db;
      mockDb.limit.mockResolvedValueOnce([mockBlock]);
      
      // Call the updateStats function with a block number
      await updateStats(1000);
      
      // Verify that statsManager.addBlock was called with the mock block
      expect(statsManager.addBlock).toHaveBeenCalledWith(mockBlock);
    });

    it('should handle case when block is not found', async () => {
      // Mock db.select().from().where().limit() to return empty result
      const mockDb = require('../../src/db').db;
      mockDb.limit.mockResolvedValueOnce([]);
      
      await updateStats(9999);
      
      // statsManager.addBlock should not be called
      expect(statsManager.addBlock).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Mock db to throw an error
      const mockDb = require('../../src/db').db;
      mockDb.limit.mockRejectedValueOnce(new Error('Database error'));
      
      // Should not throw
      await expect(updateStats(1000)).resolves.not.toThrow();
      
      // statsManager.addBlock should not be called
      expect(statsManager.addBlock).not.toHaveBeenCalled();
      
      // Error should be logged
      expect(require('../../src/utils/logger').logger.error).toHaveBeenCalled();
    });
  });
});