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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
export function startApiServer() {
  app.listen(apiPort, () => {
    console.log(`API server running on port ${apiPort}`);
  });
  
  return app;
}