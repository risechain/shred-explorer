import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './router';
import { logger } from '../utils/logger';
import { verifyApiKey } from './middleware/validate';

dotenv.config();

const app = express();
const apiPort = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
// app.use((req, res, next) => {
//   const start = Date.now();
//   res.on('finish', () => {
//     const duration = Date.now() - start;
//     logger.debug({
//       method: req.method,
//       url: req.originalUrl,
//       status: res.statusCode,
//       duration: `${duration}ms`,
//     }, `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
//   });
//   next();
// });

// Routes with API key verification
// The /health endpoint remains unprotected for infrastructure health checks
app.use('/api', verifyApiKey, router);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // For a more thorough health check, we could check database connectivity here
    // But for now, just return a success response
    const dbConnected = process.env.SKIP_DB_CHECK_HEALTH === 'true' ? true : await isDbConnected();
    
    logger.debug('Health check performed', { dbConnected });
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'not tested',
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (error) {
    // Even if the database check fails, still return a 200 for the container healthcheck
    // This prevents container restarts during temporary database issues
    logger.error('Health check database error:', error);
    res.json({ 
      status: 'warning',
      timestamp: new Date().toISOString(),
      database: 'error',
      message: 'Database connection issue, but API is running',
      version: process.env.npm_package_version || '1.0.0',
    });
  }
});

// Helper function to check database connectivity
async function isDbConnected(): Promise<boolean> {
  try {
    // Import the pool only if needed - helps prevent circular dependencies
    const { pool } = require('../db');
    
    // Only get a connection and release it immediately
    const client = await pool.connect();
    client.release();
    return true;
  } catch (error) {
    logger.error('Database connectivity check failed:', error);
    return false;
  }
}

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled API error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
});

// Start server
export function startApiServer() {
  app.listen(apiPort, () => {
    logger.info(`API server running on port ${apiPort}`);
  });
  
  return app;
}