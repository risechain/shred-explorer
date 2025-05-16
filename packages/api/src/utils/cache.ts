import NodeCache from 'node-cache';
import { logger } from './logger';

// Create cache instance with 1 second TTL
const cache = new NodeCache({
  stdTTL: 1, // 1 second TTL
  checkperiod: 2, // Check for expired keys every 2 seconds
  useClones: false // Return direct reference, not clones
});

// Cache middleware generator
export const cacheMiddleware = (keyGenerator?: (req: any) => string) => {
  return async (req: any, res: any, next: any) => {
    try {
      // Generate cache key
      const key = keyGenerator ? keyGenerator(req) : `${req.method}:${req.originalUrl}`;
      
      // Check if we have cached data
      const cachedResponse = cache.get(key);
      
      if (cachedResponse) {
        logger.debug(`Cache hit for key: ${key}`);
        return res.json(cachedResponse);
      }
      
      // If not cached, store original json method
      const originalJson = res.json;
      
      // Override json method to cache the response
      res.json = function(data: any) {
        // Cache the successful response
        cache.set(key, data);
        logger.debug(`Cached response for key: ${key}`);
        
        // Call original json method
        return originalJson.call(this, data);
      };
      
      // Continue to the actual handler
      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

// Export cache instance for direct usage if needed
export { cache };