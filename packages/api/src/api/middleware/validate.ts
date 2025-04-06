import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../../utils/logger';

dotenv.config();

/**
 * Middleware that validates requests against a Zod schema
 * 
 * @param schema The Zod schema to validate against
 * @param source Which part of the request to validate (params, query, or body)
 */
export const validate = (schema: AnyZodObject, source: 'params' | 'query' | 'body' = 'body') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate the request data against the schema
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : req.params;
      
      const validatedData = await schema.parseAsync(data);
      
      // Update the request with validated data
      if (source === 'body') req.body = validatedData;
      else if (source === 'query') req.query = validatedData;
      else req.params = validatedData;
      
      next();
    } catch (error) {
      // If validation fails, format and return error
      if (error instanceof ZodError) {
        return res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      }
      
      // For other errors, pass to the error handler
      next(error);
    }
  };
};

/**
 * Middleware to verify API key for protected routes
 * Checks the x-api-key header against the API_SECRET_KEY environment variable
 */
export const verifyApiKey = (req: Request, res: Response, next: NextFunction) => {
  // Get the API key from environment variables
  const validApiKey = process.env.API_SECRET_KEY;
  
  if (!validApiKey) {
    logger.warn('API_SECRET_KEY not configured in environment variables');
    return res.status(500).json({
      status: 'error',
      message: 'Server configuration error'
    });
  }
  
  // Check if the API key is provided in the request header
  const apiKey = req.headers['x-api-key'];
  
  // Verify the API key
  if (!apiKey || apiKey !== validApiKey) {
    logger.warn(`Invalid API key attempt from ${req.ip}, path: ${req.path}`);
    return res.status(403).json({
      status: 'error',
      message: 'Unauthorized: Invalid API key'
    });
  }
  
  // API key is valid, proceed
  next();
};