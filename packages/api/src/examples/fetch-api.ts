import fetch from 'node-fetch';

// Align with DB schema's Block type
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

interface ApiResponse<T> {
  status: 'success' | 'error';
  data: T;
  message?: string;
}

interface Stats {
  last_update: number;          // timestamp of the last block
  block_height: number;         // blocknumber of the latest block
  shreds_per_block: number;     // number of shreds in the last block
  transactions_per_block: number; // number of transactions in the last block
  avg_tps: number;              // average TPS from the last block
  avg_shred_interval: number;   // average shred interval from the last block
}

async function fetchBlocks() {
  // Fetch latest blocks with pagination
  const response = await fetch('http://localhost:8080/api/blocks/latest?limit=10&offset=0');
  const blocks = await response.json() as Block[];

  console.log(blocks[0]);
  
  console.log(`Fetched ${blocks.length} blocks:`);
  blocks.forEach(block => {
    console.log(`Block ${block.number} with ${block.transactionCount} transactions`);
  });
  return blocks[0].number
}

async function fetchBlockById(blockNumber: number) {
  try {
    const response = await fetch(`http://localhost:8080/api/blocks/${blockNumber}`);
    
    if (response.status === 404) {
      console.log(`Block ${blockNumber} not found`);
      return;
    }
    
    // Block is returned directly, not wrapped in a status/data structure
    const block = await response.json() as Block;
    console.log('Fetched block:', block);
  } catch (error) {
    console.error('Error fetching block:', error);
  }
}

async function fetchStats() {
  try {
    const response = await fetch('http://localhost:8080/api/stats');
    
    // Stats is returned directly, not wrapped in a status/data structure
    const stats = await response.json() as Stats;
    
    // Format the timestamp as a readable date
    const lastUpdateDate = new Date(stats.last_update).toLocaleString();
    
    console.log('Network Statistics:');
    console.log(`Last Update: ${lastUpdateDate} (${stats.last_update})`);
    console.log(`Latest Block: ${stats.block_height}`);
    console.log(`Shreds in Latest Block: ${stats.shreds_per_block}`);
    console.log(`Transactions in Latest Block: ${stats.transactions_per_block}`);
    console.log(`Latest Block TPS: ${stats.avg_tps ? stats.avg_tps.toFixed(2) : 'N/A'}`);
    console.log(`Latest Block Shred Interval: ${stats.avg_shred_interval ? stats.avg_shred_interval.toFixed(2) : 'N/A'} ms`);
  } catch (error) {
    console.error('Error fetching stats:', error);
  }
}

// Interface for Shred data
interface Shred {
  id: string;
  blockNumber: number;
  shredIdx: number;
  transactionCount: number;
  stateChangeCount: number;
  timestamp: string;
  shredInterval?: number;
}

// Example of fetching shreds for a specific block
async function fetchShredsForBlock(blockNumber: number) {
  try {
    const response = await fetch(`http://localhost:8080/api/blocks/${blockNumber}/shreds?limit=10&offset=0`);
    
    if (response.status === 404) {
      console.log(`Block ${blockNumber} not found`);
      return;
    }
    
    // Shreds are returned as a direct array, not wrapped in a status/data structure
    const shreds = (await response.json() as any).data as Shred[];
    console.log(shreds)
    console.log(`Fetched ${shreds.length} shreds for block ${blockNumber}:`);
    shreds.forEach(shred => {
      console.log(`Shred ${shred.shredIdx} with ${shred.transactionCount} transactions`);
    });
  } catch (error) {
    console.error('Error fetching shreds:', error);
  }
}

async function main() {
  // Fetch the list of blocks
  const id = await fetchBlocks();
  
  // Fetch a specific block by number (using a known block number from our tests)
  await fetchBlockById(id);
  
  // Fetch shreds for a block
  await fetchShredsForBlock(id);
  
  // Fetch network statistics
  await fetchStats();
}

// Run the examples
main().catch(error => {
  console.error('Error in main:', error);
});
