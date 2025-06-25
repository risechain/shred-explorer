/**
 * Retry utility for handling transient failures with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Executes a function with retry logic and exponential backoff
 * @param fn Function to execute
 * @param options Retry configuration options
 * @returns Promise that resolves with the function result
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 3000,
    onRetry
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      
      // Call the retry callback if provided
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError!;
}

/**
 * Specialized retry function for RPC calls
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  blockNumber: bigint,
  operation: string = 'RPC call'
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 8000,
    onRetry: (attempt, error) => {
      console.warn(`Block ${blockNumber}: ${operation} attempt ${attempt}/3 failed:`, error.message);
      const nextDelay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.log(`Block ${blockNumber}: Retrying ${operation} in ${nextDelay}ms...`);
    }
  });
}