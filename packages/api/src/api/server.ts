import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './router';

dotenv.config();

const app = express();
const apiPort = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', router);

// Health check
app.get('/health', async (req, res) => {
  try {
    // For a more thorough health check, we could check database connectivity here
    // But for now, just return a success response
    const dbConnected = process.env.SKIP_DB_CHECK_HEALTH === 'true' ? true : await isDbConnected();
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'not tested',
    });
  } catch (error) {
    // Even if the database check fails, still return a 200 for the container healthcheck
    // This prevents container restarts during temporary database issues
    console.error('Health check database error:', error);
    res.json({ 
      status: 'warning',
      timestamp: new Date().toISOString(),
      database: 'error',
      message: 'Database connection issue, but API is running',
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
    console.error('Database connectivity check failed:', error);
    return false;
  }
}

// Start server
export function startApiServer() {
  app.listen(apiPort, () => {
    console.log(`API server running on port ${apiPort}`);
  });
  
  return app;
}