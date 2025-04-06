import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config();

// Set up logging level based on environment
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Configure the logger
export const logger = pino({
  level: LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  base: undefined, // Remove the default pid and hostname
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

// Log starting information
logger.info(`Logger initialized with level: ${LOG_LEVEL}`);

// Export a default instance
export default logger;
