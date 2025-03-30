import WebSocket from 'ws';

// Align with the DB schema and WS server responses
interface Block {
  number: number;
  timestamp: string;
  transactionCount: number;
  shredCount: number;
  stateChangeCount: number;
  firstShredId?: number;
  lastShredId?: number;
  blockTime?: number;
  avgTps?: number;
  avgShredInterval?: number;
}

interface ServerMessage {
  type: string;
  status: 'success' | 'error';
  data: any;
  timestamp: number;
  message?: string;
}

// Connect to the WebSocket server
const ws = new WebSocket('ws://localhost:8081/ws');

// Connection opened
ws.on('open', () => {
  console.log('Connected to the WebSocket server');
  
  // Subscribe to block updates
  console.log('Subscribing to all block updates...');
  ws.send(JSON.stringify({ 
    type: 'subscribe', 
    channel: 'blocks' 
  }));
  
  // After 2 seconds, get latest blocks with a limit
  setTimeout(() => {
    console.log('Requesting latest blocks...');
    ws.send(JSON.stringify({ 
      type: 'getLatestBlocks', 
      limit: 5 
    }));
  }, 2000);
  
  // After 4 seconds, subscribe to a specific block (using a known existing block)
  setTimeout(() => {
    console.log('Subscribing to specific block...');
    ws.send(JSON.stringify({ 
      type: 'subscribeBlock', 
      blockNumber: 4025689 
    }));
  }, 4000);

  // Alternative: Use slot parameter if that's how blocks are identified
  setTimeout(() => {
    console.log('Subscribing to specific block by slot...');
    ws.send(JSON.stringify({ 
      type: 'subscribe', 
      channel: 'block', 
      slot: 4025689 
    }));
  }, 6000);
});

// Listen for messages
ws.on('message', (data: WebSocket.RawData) => {
  try {
    const message: ServerMessage = JSON.parse(data.toString());
    
    console.log(`Received ${message.type} message with status: ${message.status}`);
    
    if (message.status === 'error') {
      console.error(`Error: ${message.message}`, message.data);
      return;
    }
    
    switch (message.type) {
      case 'blockUpdate':
        const block: Block = message.data;
        console.log(`Block ${block.number} updated with ${block.transactionCount} transactions`);
        
        if (block.avgTps) {
          console.log(`Average TPS: ${block.avgTps.toFixed(2)}`);
        }
        
        if (block.avgShredInterval) {
          console.log(`Average Shred Interval: ${block.avgShredInterval.toFixed(2)} ms`);
        }
        break;
        
      case 'blockDetails':
        const blockDetails: Block = message.data;
        console.log(`Block details for block ${blockDetails.number}:`);
        console.log(`- Transactions: ${blockDetails.transactionCount}`);
        console.log(`- Shreds: ${blockDetails.shredCount}`);
        console.log(`- State Changes: ${blockDetails.stateChangeCount}`);
        break;
      
      case 'latestBlocks':
        const blocks: Block[] = message.data;
        console.log(`Received ${blocks.length} latest blocks:`);
        blocks.forEach(block => {
          console.log(`- Block ${block.number}: ${block.transactionCount} transactions, ${block.shredCount} shreds`);
        });
        break;
        
      case 'subscribed':
        console.log(`Successfully subscribed: ${message.message}`);
        break;
        
      default:
        console.log('Data:', message.data);
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

// Connection closed
ws.on('close', () => {
  console.log('Disconnected from the WebSocket server');
});

// Connection error
ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Closing WebSocket connection');
  ws.close();
  process.exit(0);
});
