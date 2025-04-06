import request from 'supertest';
import express from 'express';
import router from '../../src/api/router';
import { statsManager } from '../../src/utils/stats';

// Mock dependencies
jest.mock('../../src/db', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    count: jest.fn(),
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

// Mock the stats manager
jest.mock('../../src/utils/stats', () => {
  const mockStats = {
    tps: 18.75,
    gasPerSecond: 625000,
    shredInterval: 53.33
  };

  return {
    statsManager: {
      getStats: jest.fn().mockReturnValue(mockStats),
      getStatsWindowSize: jest.fn().mockReturnValue(10),
    }
  };
});

describe('Stats API Endpoints', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/', router);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('should return stats with default window size', async () => {
      const response = await request(app).get('/stats');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      
      // Verify data structure
      expect(response.body.data).toHaveProperty('tps', 18.75);
      expect(response.body.data).toHaveProperty('gasPerSecond', 625000);
      expect(response.body.data).toHaveProperty('shredInterval', 53.33);
      expect(response.body.data).toHaveProperty('windowSize', 10);
      
      // Verify the stats manager was called correctly
      expect(statsManager.getStats).toHaveBeenCalledTimes(1);
      expect(statsManager.getStatsWindowSize).toHaveBeenCalledTimes(1);
    });

    it('should ignore window size parameter', async () => {
      const response = await request(app).get('/stats?window=20');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      
      // Window size should remain fixed
      expect(response.body.data).toHaveProperty('windowSize', 10);
    });

    it('should return 404 when no stats are available', async () => {
      // Mock statsManager to return null (no stats)
      (statsManager.getStats as jest.Mock).mockReturnValueOnce(null);
      
      const response = await request(app).get('/stats');
      
      expect(response.status).toBe(404);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('No blocks found to calculate statistics');
    });
  });
});