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