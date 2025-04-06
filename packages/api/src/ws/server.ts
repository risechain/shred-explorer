import * as WebSocket from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { getBlockDetails, getLatestBlocks } from '../db/listener';
import { wsMessageSchema } from '../api/schemas';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { statsManager } from '../utils/stats';

dotenv.config();

// Define message types
interface ServerMessage {
  type: string;
  data: any;
  timestamp: number;
  status?: string;
  message?: string;
}

// Create WebSocket server
export function createWebSocketServer(port: number = Number(process.env.WS_PORT) || 3002) {
  const server = http.createServer();
  
  // Setup WebSocket server without authentication (open access)
  const wss = new WebSocket.Server({ 
    server
  });
  
  // Connected clients
  const clients = new Set<WebSocket>();

  // Send a message to a client
  const sendMessage = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  // Send an error message to a client
  const sendError = (ws: WebSocket, message: string, details?: any) => {
    sendMessage(ws, {
      type: 'error',
      status: 'error',
      message,
      data: details || null,
      timestamp: Date.now()
    });
  };

  // Handle new WebSocket connections
  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected');
    clients.add(ws);

    // Send initial data - the latest 10 blocks
    getLatestBlocks(10).then(blocks => {
      logger.debug(`Sending initial ${blocks.length} blocks to new client`);
      sendMessage(ws, {
        type: 'latestBlocks',
        status: 'success',
        data: blocks,
        timestamp: Date.now()
      });
      
      // Also send pre-calculated stats
      const currentStats = statsManager.getStats();
      if (currentStats) {
        sendMessage(ws, {
          type: 'statsUpdate',
          status: 'success',
          data: {
            ...currentStats,
            windowSize: statsManager.getStatsWindowSize()
          },
          timestamp: Date.now()
        });
      }
    }).catch(err => {
      logger.error('Error fetching initial blocks:', err);
      sendError(ws, 'Error fetching initial blocks');
    });

    // Handle client messages
    ws.on('message', async (message: string) => {
      try {
        // Parse and validate the incoming message
        const parsedData = JSON.parse(message);
        logger.debug(`Received WebSocket message: ${JSON.stringify(parsedData)}`);
        
        try {
          // Validate using Zod schema
          const validatedMessage = wsMessageSchema.parse(parsedData);
          
          // Process validated message
          switch (validatedMessage.type) {
            case 'subscribeBlock':
              const blockNumber = validatedMessage.blockNumber || validatedMessage.slot;
              if (blockNumber) {
                logger.info(`Client subscribed to block ${blockNumber}`);
                const block = await getBlockDetails(blockNumber);
                if (block) {
                  sendMessage(ws, {
                    type: 'blockDetails',
                    status: 'success',
                    data: block,
                    timestamp: Date.now()
                  });
                } else {
                  logger.warn(`Block ${blockNumber} not found when client subscribed`);
                  sendError(ws, `Block ${blockNumber} not found`);
                }
              }
              break;
              
            case 'getLatestBlocks':
              const limit = validatedMessage.limit || 10;
              logger.info(`Client requested latest ${limit} blocks`);
              const latestBlocks = await getLatestBlocks(limit);
              sendMessage(ws, {
                type: 'latestBlocks',
                status: 'success',
                data: latestBlocks,
                timestamp: Date.now()
              });
              break;

            case 'getStats':
              logger.info('Client requested current stats');
              
              // Get and send the pre-calculated stats
              const stats = statsManager.getStats();
              if (stats) {
                sendMessage(ws, {
                  type: 'statsUpdate',
                  status: 'success',
                  data: {
                    ...stats,
                    windowSize: statsManager.getStatsWindowSize()
                  },
                  timestamp: Date.now()
                });
              } else {
                sendError(ws, 'No stats available');
              }
              break;
              
            case 'subscribe':
              if (validatedMessage.channel === 'blocks') {
                // Subscribe to all block updates
                logger.info('Client subscribed to all block updates');
                sendMessage(ws, {
                  type: 'subscribed',
                  status: 'success',
                  data: { channel: 'blocks' },
                  message: 'Subscribed to block updates',
                  timestamp: Date.now()
                });
              } else if (validatedMessage.channel === 'block' && validatedMessage.slot) {
                // Subscribe to specific block updates
                logger.info(`Client subscribed to block ${validatedMessage.slot} updates`);
                sendMessage(ws, {
                  type: 'subscribed',
                  status: 'success',
                  data: { channel: 'block', slot: validatedMessage.slot },
                  message: `Subscribed to block ${validatedMessage.slot} updates`,
                  timestamp: Date.now()
                });
              } else if (validatedMessage.channel === 'stats') {
                // Subscribe to stats updates
                logger.info('Client subscribed to stats updates');
                
                sendMessage(ws, {
                  type: 'subscribed',
                  status: 'success',
                  data: { 
                    channel: 'stats',
                    windowSize: statsManager.getStatsWindowSize()
                  },
                  message: 'Subscribed to stats updates',
                  timestamp: Date.now()
                });
                
                // Send initial pre-calculated stats
                const currentStats = statsManager.getStats();
                if (currentStats) {
                  sendMessage(ws, {
                    type: 'statsUpdate',
                    status: 'success',
                    data: {
                      ...currentStats,
                      windowSize: statsManager.getStatsWindowSize()
                    },
                    timestamp: Date.now()
                  });
                }
              }
              break;
              
            default:
              logger.warn(`Client sent unknown message type: ${validatedMessage.type}`);
              sendError(ws, `Unknown message type: ${validatedMessage.type}`);
          }
        } catch (validationError) {
          // Send validation errors back to client
          if (validationError instanceof ZodError) {
            logger.warn('WebSocket message validation failed:', validationError.errors);
            sendError(ws, 'Validation failed', {
              errors: validationError.errors.map(err => ({
                path: err.path.join('.'),
                message: err.message
              }))
            });
          } else {
            throw validationError; // re-throw non-Zod errors
          }
        }
      } catch (err) {
        logger.error('Error processing WebSocket message:', err);
        sendError(ws, 'Error processing message');
      }
    });

    // Handle disconnections
    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      clients.delete(ws);
    });
  });

  // Function to broadcast block updates to all connected clients
  const broadcastBlockUpdate = async (blockNumber: number) => {
    const block = await getBlockDetails(blockNumber);
    if (!block) {
      logger.warn(`Failed to broadcast block update: Block ${blockNumber} not found`);
      return;
    }
    
    // logger.info(`Broadcasting block ${blockNumber} update to ${clients.size} clients`);
    
    // Broadcast block update
    const blockMessage: ServerMessage = {
      type: 'blockUpdate',
      status: 'success',
      data: block,
      timestamp: Date.now()
    };
    
    // Also broadcast updated pre-calculated stats
    const stats = statsManager.getStats();
    const statsMessage: ServerMessage = {
      type: 'statsUpdate',
      status: 'success',
      data: stats ? {
        ...stats,
        windowSize: statsManager.getStatsWindowSize()
      } : null,
      timestamp: Date.now()
    };
    
    const blockMessageStr = JSON.stringify(blockMessage);
    const statsMessageStr = JSON.stringify(statsMessage);
    let sentCount = 0;
    
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        // Send both block and stats updates
        client.send(blockMessageStr);
        if (stats) {
          client.send(statsMessageStr);
        }
        sentCount++;
      }
    }
    
    logger.debug(`Block and stats updates sent to ${sentCount} clients`);
  };

  // Start the server
  server.listen(port, () => {
    logger.info(`WebSocket server is running on port ${port}`);
  });

  return {
    server,
    wss,
    broadcastBlockUpdate
  };
}