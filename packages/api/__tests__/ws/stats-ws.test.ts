import * as WebSocket from 'ws';
import * as http from 'http';
import { createWebSocketServer } from '../../src/ws/server';
import { statsManager } from '../../src/utils/stats';

// Mock dependencies
jest.mock('../../src/db/listener', () => ({
  getBlockDetails: jest.fn().mockResolvedValue({
    number: 1000,
    hash: '0x123',
    timestamp: 1616451600,
    transactionCount: 150,
  }),
  getLatestBlocks: jest.fn().mockResolvedValue([
    {
      number: 1000,
      hash: '0x123',
      timestamp: 1616451600,
      transactionCount: 150,
    },
  ]),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/stats', () => {
  const mockStats = {
    tps: 18.75,
    gasPerSecond: 625000,
    shredInterval: 53.33
  };

  return {
    statsManager: {
      getStats: jest.fn().mockReturnValue(mockStats),
      getStatsWindowSize: jest.fn().mockReturnValue(10),
    }
  };
});

describe('WebSocket Stats Service', () => {
  let server: http.Server;
  let wss: WebSocket.Server;
  let broadcastBlockUpdate: (blockNumber: number) => Promise<void>;
  let wsClient: WebSocket;
  const TEST_PORT = 8888;
  const WS_URL = `ws://localhost:${TEST_PORT}`;

  beforeEach((done) => {
    // Create a WebSocket server for testing
    const wsServer = createWebSocketServer(TEST_PORT);
    server = wsServer.server;
    wss = wsServer.wss;
    broadcastBlockUpdate = wsServer.broadcastBlockUpdate;
    
    // Wait for the server to start
    setTimeout(() => {
      // Create a client connection
      wsClient = new WebSocket(WS_URL);
      
      wsClient.on('open', () => {
        // Reset all mocks after connection is established
        jest.clearAllMocks();
        done();
      });
      
      wsClient.on('error', (error) => {
        console.error('WebSocket client error:', error);
        done(error);
      });
    }, 100);
  });

  afterEach((done) => {
    // Clean up connections
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    
    wss.close(() => {
      server.close(() => {
        done();
      });
    });
  });

  describe('Initial connection', () => {
    it('should send initial stats on connection', (done) => {
      // Listen for messages from the server
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Look for the stats update message
        if (message.type === 'statsUpdate') {
          expect(message.status).toBe('success');
          expect(message.data).toHaveProperty('tps', 18.75);
          expect(message.data).toHaveProperty('gasPerSecond', 625000);
          expect(message.data).toHaveProperty('shredInterval', 53.33);
          expect(message.data).toHaveProperty('windowSize', 10);
          
          // Verify the stats manager was called
          expect(statsManager.getStats).toHaveBeenCalled();
          
          done();
        }
      });
    });
  });

  describe('Broadcast updates', () => {
    it('should broadcast stats when a new block is received', (done) => {
      // Set up listener for broadcast messages
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // If we get a stats update message after the initial connection
        if (message.type === 'statsUpdate' && statsManager.getStats.mock.calls.length >= 2) {
          expect(message.status).toBe('success');
          expect(message.data).toHaveProperty('tps', 18.75);
          expect(message.data).toHaveProperty('gasPerSecond', 625000);
          expect(message.data).toHaveProperty('shredInterval', 53.33);
          expect(message.data).toHaveProperty('windowSize', 10);
          done();
        }
      });
      
      // Wait for initial connection messages to be processed
      setTimeout(() => {
        // Reset mocks to track new calls
        jest.clearAllMocks();
        
        // Simulate a new block notification
        broadcastBlockUpdate(1001);
      }, 100);
    });
  });

  describe('Stats subscription', () => {
    it('should send stats when client subscribes to stats channel', (done) => {
      // Clear any previous messages
      jest.clearAllMocks();
      
      // Set up listener for subscription response
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // If we get a stats update after subscribing
        if (message.type === 'statsUpdate' && message.data && message.data.windowSize === 10) {
          expect(message.status).toBe('success');
          expect(message.data).toHaveProperty('tps', 18.75);
          expect(message.data).toHaveProperty('gasPerSecond', 625000);
          expect(message.data).toHaveProperty('shredInterval', 53.33);
          done();
        }
      });
      
      // Subscribe to stats channel
      wsClient.send(JSON.stringify({
        type: 'subscribe',
        channel: 'stats'
      }));
    });

    it('should ignore window size in subscription request', (done) => {
      // Set up listener for subscription response
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Check that subscription was confirmed
        if (message.type === 'subscribed' && message.data && message.data.channel === 'stats') {
          // Window size should be fixed
          expect(message.data.windowSize).toBe(10);
          done();
        }
      });
      
      // Subscribe to stats with a window size (which should be ignored)
      wsClient.send(JSON.stringify({
        type: 'subscribe',
        channel: 'stats',
        windowSize: 15
      }));
    });
  });

  describe('Stats request', () => {
    it('should send stats when explicitly requested', (done) => {
      // Clear any previous messages
      jest.clearAllMocks();
      
      // Set up listener for response
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Look for stats response after explicit request
        if (message.type === 'statsUpdate' && statsManager.getStats.mock.calls.length > 0) {
          expect(message.status).toBe('success');
          expect(message.data).toHaveProperty('tps', 18.75);
          expect(message.data).toHaveProperty('gasPerSecond', 625000);
          expect(message.data).toHaveProperty('shredInterval', 53.33);
          done();
        }
      });
      
      // Request stats
      wsClient.send(JSON.stringify({
        type: 'getStats'
      }));
    });

    it('should ignore window size in stats request', (done) => {
      // Set up listener for response
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Check the stats response
        if (message.type === 'statsUpdate') {
          // Window size should be fixed
          expect(message.data.windowSize).toBe(10);
          done();
        }
      });
      
      // Request stats with window size (which should be ignored)
      wsClient.send(JSON.stringify({
        type: 'getStats',
        windowSize: 20
      }));
    });
  });
});