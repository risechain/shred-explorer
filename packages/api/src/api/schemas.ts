import { z } from 'zod';

// Schema for block number parameter
export const blockNumberSchema = z.object({
  number: z.string().transform((val) => {
    const parsed = parseInt(val);
    if (isNaN(parsed)) {
      throw new Error('Invalid block number');
    }
    return parsed;
  })
});

// Schema for pagination query parameters
export const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => {
    if (!val) return 10; // default limit
    const parsed = parseInt(val);
    if (isNaN(parsed) || parsed < 1) {
      return 10; // default if invalid
    }
    return parsed > 100 ? 100 : parsed; // max 100
  }),
  offset: z.string().optional().transform((val) => {
    if (!val) return 0; // default offset
    const parsed = parseInt(val);
    if (isNaN(parsed) || parsed < 0) {
      return 0; // default if invalid
    }
    return parsed;
  })
});

// Schema for block response
export const blockResponseSchema = z.object({
  number: z.number(),
  hash: z.string(),
  parentHash: z.string(),
  timestamp: z.number(),
  transactionCount: z.number(),
  transactions: z.array(
    z.object({
      hash: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      value: z.string(),
      transactionIndex: z.number(),
    })
  ).optional()
});

// Schema for stats response
export const statsResponseSchema = z.object({
  tps: z.number(),
  shredInterval: z.number().optional(),
  gasPerSecond: z.number(),
  windowSize: z.number().optional()
});

// Schema for WebSocket message validation
export const wsMessageSchema = z.object({
  type: z.enum(['subscribe', 'subscribeBlock', 'getLatestBlocks', 'getStats']),
  channel: z.enum(['blocks', 'block', 'stats']).optional(),
  blockNumber: z.number().int().positive().optional(),
  slot: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional()
}).refine(data => {
  // If type is subscribeBlock, require blockNumber
  if (data.type === 'subscribeBlock' && !data.blockNumber && !data.slot) {
    return false;
  }
  
  // If type is subscribe with channel=block, require slot
  if (data.type === 'subscribe' && data.channel === 'block' && !data.slot) {
    return false;
  }
  
  return true;
}, {
  message: "Missing required fields for the specified message type"
});