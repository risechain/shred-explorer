'use client';

import { useEffect, useState } from 'react';

// Types
interface Stats {
  avg_tps: number;
  avg_shred_interval: number;
  block_height: number;
  transactions_per_block: number;
  last_update: number;
}

interface Block {
  number: number;
  timestamp: string;
  transactionCount: number;
  shredCount: number;
  blockTime: number | null;
  avgTps: number | null;
}

interface Transaction {
  id: number;
  shredId: number;
  transactionData: any;
  receiptData: any;
}

// API URLs - configure based on environment
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8081/ws';

export default function Home() {
  // State hooks
  const [stats, setStats] = useState<Stats | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Fetch initial data
  useEffect(() => {
    const fetchStats = async () => {
      try {
        console.log(`${API_BASE_URL}/stats`)
        const response = await fetch(`${API_BASE_URL}/stats`);
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        console.error('Error fetching stats:', err);
        setError('Failed to load stats');
      }
    };

    const fetchBlocks = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/blocks/latest?limit=10`);
        if (!response.ok) {
          throw new Error('Failed to fetch blocks');
        }
        const data = await response.json();
        setBlocks(data);
      } catch (err) {
        console.error('Error fetching blocks:', err);
        setError('Failed to load blocks');
      }
    };

    // Fetch initial data
    const fetchInitialData = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchBlocks()]);
      setLoading(false);
    };

    fetchInitialData();
  }, []);

  // WebSocket connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    
    const connectWebSocket = () => {
      ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
        
        // Subscribe to block updates
        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'blocks'
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'blockUpdate') {
            // Update stats
            setStats(prevStats => {
              if (!prevStats) return prevStats;
              
              return {
                ...prevStats,
                block_height: message.data.number,
                avg_tps: message.data.avgTps || prevStats.avg_tps,
                avg_shred_interval: message.data.avgShredInterval || prevStats.avg_shred_interval,
                last_update: message.timestamp
              };
            });
            
            // Update blocks list
            setBlocks(prevBlocks => {
              const newBlock = message.data;
              const exists = prevBlocks.some(block => block.number === newBlock.number);
              
              if (exists) {
                return prevBlocks.map(block => 
                  block.number === newBlock.number ? newBlock : block
                );
              } else {
                return [newBlock, ...prevBlocks].slice(0, 10);
              }
            });
          } else if (message.type === 'latestBlocks') {
            setBlocks(message.data);
          }
        } catch (err) {
          console.error('Error processing WebSocket message:', err);
        }
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        
        // Attempt to reconnect after a delay
        setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws?.close();
      };
    };
    
    connectWebSocket();
    
    // Cleanup on unmount
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  // Calculate MGas/s (using TPS as an approximation for now)
  const calculateMGasPerSecond = () => {
    if (!stats) return 0;
    // This is a simplified calculation - in a real app, we would get actual gas usage
    const avgGasPerTx = 50000; // Example average gas per transaction
    return ((stats.avg_tps * avgGasPerTx) / 1000000).toFixed(2);
  };

  // Display loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl font-bold">Loading...</div>
      </div>
    );
  }

  // Display error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl font-bold text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-2">RISE Explorer</h1>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm text-gray-500">
            {wsConnected ? 'WebSocket Connected' : 'WebSocket Disconnected'}
          </span>
        </div>
      </header>

      {/* Stats Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* TPS Tile */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-2">TPS</div>
          <div className="text-3xl font-bold">{stats?.avg_tps.toFixed(2) || '0'}</div>
        </div>

        {/* MGas/s Tile */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-2">MGas/s</div>
          <div className="text-3xl font-bold">{calculateMGasPerSecond()}</div>
        </div>

        {/* Block Height Tile */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-2">Block Height</div>
          <div className="text-3xl font-bold">{stats?.block_height.toLocaleString() || '0'}</div>
        </div>

        {/* ShredTime Tile */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-2">Shred Time (ms)</div>
          <div className="text-3xl font-bold">{stats?.avg_shred_interval.toFixed(2) || '0'}</div>
        </div>
      </div>

      {/* Tables Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Blocks Table */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Latest Blocks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-700">
                  <th className="px-4 py-2 text-left">Number</th>
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Transactions</th>
                  <th className="px-4 py-2 text-left">Shreds</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => (
                  <tr key={block.number} className="border-b border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-2 font-medium">{block.number}</td>
                    <td className="px-4 py-2">{formatTimestamp(block.timestamp)}</td>
                    <td className="px-4 py-2">{block.transactionCount}</td>
                    <td className="px-4 py-2">{block.shredCount}</td>
                  </tr>
                ))}
                {blocks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-center">No blocks available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Transactions Table */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Latest Transactions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-700">
                  <th className="px-4 py-2 text-left">Transaction Hash</th>
                  <th className="px-4 py-2 text-left">Block</th>
                  <th className="px-4 py-2 text-left">From</th>
                  <th className="px-4 py-2 text-left">To</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length > 0 ? (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2 font-medium">{tx.transactionData?.hash?.substring(0, 10) || '0x...'}</td>
                      <td className="px-4 py-2">{tx.transactionData?.blockNumber || 'N/A'}</td>
                      <td className="px-4 py-2">{tx.transactionData?.from?.substring(0, 10) || '0x...'}</td>
                      <td className="px-4 py-2">{tx.transactionData?.to?.substring(0, 10) || '0x...'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-center">No transactions available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <footer className="mt-16 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} RISE Explorer</p>
      </footer>
    </div>
  );
}