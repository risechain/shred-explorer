import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

// Create a PostgreSQL connection pool
// Use DATABASE_URL if available, otherwise construct from individual environment variables
const connectionConfig = process.env.DATABASE_URL 
  ? { 
      connectionString: process.env.DATABASE_URL 
    }
  : {
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
    };

// Log connection details (without password)
console.log('DB Connection Config:');
if ('connectionString' in connectionConfig) {
  // Mask the password in the connection string for logging
  const maskedUrl = connectionConfig.connectionString?.replace(/:([^:@]+)@/, ':***@');
  console.log(`- Using connection string: ${maskedUrl}`);
} else {
  console.log(`- Host: ${connectionConfig.host}`);
  console.log(`- Port: ${connectionConfig.port}`);
  console.log(`- Database: ${connectionConfig.database}`);
  console.log(`- User: ${connectionConfig.user}`);
  console.log(`- Password: ${connectionConfig.password}`);
}

const pool = new Pool(connectionConfig);

// Initialize Drizzle with the pool and schema
export const db = drizzle(pool, { schema });

// Export the pool for pg-listen
export { pool };