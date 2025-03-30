import * as WebSocket from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';
import { getBlockDetails, getLatestBlocks } from '../db/listener';
import { wsMessageSchema } from '../api/schemas';
import { ZodError } from 'zod';

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
  const wss = new WebSocket.Server({ server });
  
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
    console.log('Client connected');
    clients.add(ws);

    // Send initial data - the latest 10 blocks
    getLatestBlocks(10).then(blocks => {
      sendMessage(ws, {
        type: 'latestBlocks',
        status: 'success',
        data: blocks,
        timestamp: Date.now()
      });
    }).catch(err => {
      console.error('Error fetching initial blocks:', err);
      sendError(ws, 'Error fetching initial blocks');
    });

    // Handle client messages
    ws.on('message', async (message: string) => {
      try {
        // Parse and validate the incoming message
        const parsedData = JSON.parse(message);
        
        try {
          // Validate using Zod schema
          const validatedMessage = wsMessageSchema.parse(parsedData);
          
          // Process validated message
          switch (validatedMessage.type) {
            case 'subscribeBlock':
              const blockNumber = validatedMessage.blockNumber || validatedMessage.slot;
              if (blockNumber) {
                const block = await getBlockDetails(blockNumber);
                if (block) {
                  sendMessage(ws, {
                    type: 'blockDetails',
                    status: 'success',
                    data: block,
                    timestamp: Date.now()
                  });
                } else {
                  sendError(ws, `Block ${blockNumber} not found`);
                }
              }
              break;
              
            case 'getLatestBlocks':
              const limit = validatedMessage.limit || 10;
              const latestBlocks = await getLatestBlocks(limit);
              sendMessage(ws, {
                type: 'latestBlocks',
                status: 'success',
                data: latestBlocks,
                timestamp: Date.now()
              });
              break;
              
            case 'subscribe':
              if (validatedMessage.channel === 'blocks') {
                // Subscribe to all block updates
                console.log('Client subscribed to all block updates');
                sendMessage(ws, {
                  type: 'subscribed',
                  status: 'success',
                  data: { channel: 'blocks' },
                  message: 'Subscribed to block updates',
                  timestamp: Date.now()
                });
              } else if (validatedMessage.channel === 'block' && validatedMessage.slot) {
                // Subscribe to specific block updates
                console.log(`Client subscribed to block ${validatedMessage.slot} updates`);
                sendMessage(ws, {
                  type: 'subscribed',
                  status: 'success',
                  data: { channel: 'block', slot: validatedMessage.slot },
                  message: `Subscribed to block ${validatedMessage.slot} updates`,
                  timestamp: Date.now()
                });
              }
              break;
              
            default:
              sendError(ws, `Unknown message type: ${validatedMessage.type}`);
          }
        } catch (validationError) {
          // Send validation errors back to client
          if (validationError instanceof ZodError) {
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
        console.error('Error processing message:', err);
        sendError(ws, 'Error processing message');
      }
    });

    // Handle disconnections
    ws.on('close', () => {
      console.log('Client disconnected');
      clients.delete(ws);
    });
  });

  // Function to broadcast block updates to all connected clients
  const broadcastBlockUpdate = async (blockNumber: number) => {
    const block = await getBlockDetails(blockNumber);
    if (!block) return;
    
    const message: ServerMessage = {
      type: 'blockUpdate',
      status: 'success',
      data: block,
      timestamp: Date.now()
    };
    
    const messageStr = JSON.stringify(message);
    
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  };

  // Start the server
  server.listen(port, () => {
    console.log(`WebSocket server is running on port ${port}`);
  });

  return {
    server,
    wss,
    broadcastBlockUpdate
  };
}