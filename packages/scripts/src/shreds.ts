// Define TypeScript interfaces for the Shred data structure
interface Transaction {
  transaction: Record<string, any>;
  receipt: Record<string, any>;
}

interface StateChange {
  nonce: number;
  balance: string;
  code: string;
  storage: Record<string, any>;
}

interface Shred {
  block_number: number;
  shred_idx: number;
  transactions: Transaction[];
  state_changes: Record<string, StateChange>;
}

interface WebSocketMessage {
  params: {
    result: Shred;
  };
}

// WebSocket connection
const socket = new WebSocket("wss://staging.riselabs.xyz/ws");
let last_shred_time = Date.now();

socket.addEventListener("message", (event: MessageEvent) => {
  const now = Date.now();
  try {
    const data = JSON.parse(event.data as string) ;
    if (data.result) {
      return
    }
    const shred: Shred = data.params.result;
    
    console.log('interval', now - last_shred_time, 'ms');
    last_shred_time = now;

    console.log(shred);
  } catch (err) {
    console.log(err);
  }
});

// JSON-RPC request interface
interface JsonRpcRequest {
  method: string;
  params: any[];
  id: number;
  jsonrpc: string;
}

socket.addEventListener("open", (event: Event) => {
  const request: JsonRpcRequest = {
    method: "rise_subscribe",
    params: [],
    id: 1,
    jsonrpc: "2.0",
  };
  
  socket.send(JSON.stringify(request));
});

