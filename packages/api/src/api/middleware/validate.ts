import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

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