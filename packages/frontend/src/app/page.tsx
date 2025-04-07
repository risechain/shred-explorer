'use client';

import { useEffect, useState, useMemo } from 'react';
import NumberFlow from '@number-flow/react';
import { 
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Paper, Card, CardContent, Typography, Box, Chip,
  ThemeProvider, createTheme, CssBaseline
} from '@mui/material';

// Types
interface Stats {
  tps: number;
  shredInterval?: number;
  gasPerSecond: number;
  windowSize: number;
  lastUpdate?: number; // For our UI tracking
}

interface Block {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  transactionCount: number;
  transactions?: Transaction[];
}

interface Transaction {
  hash: string;
  from?: string;
  to?: string;
  value: string;
  transactionIndex: number;
}

// API URLs - configure based on environment
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3002';

// API headers configuration is handled in proxy endpoints

// Create a theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#3f51b5',
    },
    secondary: {
      main: '#f50057',
    },
    background: {
      default: '#f5f5f7', // Light gray background for better contrast
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h3: {
      fontWeight: 700,
      fontSize: '1.75rem',
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.5rem',
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.25rem',
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          transition: 'box-shadow 0.3s ease-in-out',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '16px 20px',
          '&:last-child': {
            paddingBottom: 16,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '12px 16px',
          borderColor: 'rgba(224, 224, 224, 0.5)',
        },
        head: {
          fontWeight: 600,
          backgroundColor: 'rgba(0, 0, 0, 0.03)',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.2s ease',
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        },
      },
    },
  },
});

// Helper function to generate transaction rows - separated from the component render process
// to avoid React hooks rules violations (can't use hooks conditionally)
function getTransactionRows(blocks: Block[]) {
  // Process and collect transactions from all blocks
  const allTransactions: Array<{tx: Transaction, blockNumber: number}> = [];
  
  // Iterate once through all blocks
  for (const block of blocks) {
    if (!block.transactions || block.transactions.length === 0) continue;
    
    // Don't modify the original transactions array, create a new one
    const reversedTxs = [...block.transactions].reverse();
    
    for (let i = 0; i < reversedTxs.length; i++) {
      const tx = reversedTxs[i];
      allTransactions.push({
        tx: {
          ...tx,
          // Preserve the transaction index if it exists
          transactionIndex: tx.transactionIndex !== undefined ? 
            tx.transactionIndex : (reversedTxs.length - i)
        },
        blockNumber: block.number
      });
      
      // Only collect up to 10 transactions total
      if (allTransactions.length >= 10) break;
    }
    
    // Early exit if we already have 10 transactions
    if (allTransactions.length >= 10) break;
  }
  
  // Display transactions
  if (allTransactions.length > 0) {
    return allTransactions.map(({tx, blockNumber}) => (
      <TableRow key={`${blockNumber}-${tx.hash}`}>
        <TableCell>
          <Typography
            component="a"
            href={`https://explorer.testnet.riselabs.xyz/tx/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ 
              fontFamily: 'monospace', 
              fontSize: '0.85rem', 
              color: 'primary.main', 
              textDecoration: 'none', 
              '&:hover': { textDecoration: 'underline' },
              display: 'inline-block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {tx.hash.substring(0, 14) || '0x...'}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography
            component="a"
            href={`https://explorer.testnet.riselabs.xyz/block/${blockNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ 
              color: 'primary.main', 
              textDecoration: 'none', 
              '&:hover': { textDecoration: 'underline' } 
            }}
          >
            {blockNumber}
          </Typography>
        </TableCell>
        <TableCell align="center">{tx.transactionIndex !== undefined ? tx.transactionIndex : 'N/A'}</TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
          {(parseInt(tx.value || '0') / 1e18).toFixed(4)} ETH
        </TableCell>
      </TableRow>
    ));
  } else {
    return (
      <TableRow>
        <TableCell colSpan={4} align="center">No transactions available</TableCell>
      </TableRow>
    );
  }
}

export default function Home() {
  // State hooks
  const [stats, setStats] = useState<Stats | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [newTransactionCount, setNewTransactionCount] = useState(0);
  const [latestBlockNumber, setLatestBlockNumber] = useState<number | null>(null);
  const [animatingTransactionCounts, setAnimatingTransactionCounts] = useState<{[blockNumber: number]: number}>({});

  // Fetch initial data
  useEffect(() => {
    const fetchStats = async () => {
      try {
        console.log(`${API_BASE_URL}/stats`);
        // Use our API proxy endpoint instead of direct connection
        const response = await fetch('/api/stats');
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        const data = await response.json();
        
        if (data.status === 'success' && data.data) {
          const statsData: Stats = {
            ...data.data,
            lastUpdate: Date.now() // Add current timestamp for our UI
          };
          setStats(statsData);
        } else {
          throw new Error('Invalid stats data format');
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
        setError('Failed to load stats');
      }
    };

    const fetchBlocks = async () => {
      try {
        // Use our API proxy endpoint instead of direct connection
        const response = await fetch('/api/blocks/latest?limit=10');
        if (!response.ok) {
          throw new Error('Failed to fetch blocks');
        }
        const data = await response.json();
        
        if (data.status === 'success' && data.data && Array.isArray(data.data.blocks)) {
          // Get latest blocks and ensure each transaction has a transactionIndex
          let blocks = data.data.blocks.slice(0, 10);
          blocks = blocks.map((block: Block) => {
            if (block.transactions && block.transactions.length > 0) {
              const updatedTransactions = block.transactions.map((tx: Transaction, i: number) => ({
                ...tx,
                transactionIndex: tx.transactionIndex !== undefined ? tx.transactionIndex : i
              }));
              return { ...block, transactions: updatedTransactions };
            }
            return block;
          });
          
          
          // Set the latest block number for animation if there are blocks
          if (blocks.length > 0) {
            setLatestBlockNumber(blocks[0].number);
            
            // Start animation for this block's transaction count
            if (blocks[0].transactionCount > 0) {
              setAnimatingTransactionCounts(prev => ({
                ...prev,
                [blocks[0].number]: 0
              }));
            }
          }
          
          setBlocks(blocks);
        } else {
          throw new Error('Invalid blocks data format');
        }
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
      try {
        // Create WebSocket connection without authentication
        console.log(`Connecting to WebSocket: ${WS_URL}`);
        ws = new WebSocket(WS_URL);
        
        ws.onopen = () => {
          console.log('WebSocket connected');
          setWsConnected(true);
          
          // Subscribe to block updates
          if (ws) {
            ws.send(JSON.stringify({
              type: 'subscribe',
              channel: 'blocks'
            }));
            
            // Also subscribe to stats updates
            ws.send(JSON.stringify({
              type: 'subscribe',
              channel: 'stats'
            }));
          }
        };
      
      if (ws) {
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
          
            // Handle block updates
            if (message.type === 'blockUpdate' && message.status === 'success') {
              // Create a shallow copy of the block data
              const newBlock = message.data;
              
              // Ensure transactions have transactionIndex
              if (newBlock.transactions && newBlock.transactions.length > 0) {
                newBlock.transactions = newBlock.transactions.map((tx: Transaction, i: number) => ({
                  ...tx,
                  transactionIndex: tx.transactionIndex !== undefined ? tx.transactionIndex : i
                }));
              }
              
              // Update blocks list
              setBlocks(prevBlocks => {
                const exists = prevBlocks.some(block => block.number === newBlock.number);
                
                // Update transaction count for new blocks
                if (!exists && newBlock.transactionCount) {
                  setNewTransactionCount(prev => prev + newBlock.transactionCount);
                }
                
                if (exists) {
                  return prevBlocks.map(block => 
                    block.number === newBlock.number ? newBlock : block
                  );
                } else {
                  // Set the latest block number for animation
                  setLatestBlockNumber(newBlock.number);
                  
                  // Start animation for this block's transaction count
                  if (newBlock.transactionCount > 0) {
                    setAnimatingTransactionCounts(prev => ({
                      ...prev,
                      [newBlock.number]: 0
                    }));
                  }
                  
                  return [newBlock, ...prevBlocks].slice(0, 10);
                }
              });
            } 
            // Handle stats updates
            else if (message.type === 'statsUpdate' && message.status === 'success') {
              setStats(prevStats => {
                if (!prevStats) return message.data;
                
                return {
                  ...message.data,
                  lastUpdate: message.timestamp
                };
              });
            }
            // Handle initial blocks list
            else if (message.type === 'latestBlocks' && message.status === 'success') {
              // Process transactions properly
              const processedBlocks = message.data.slice(0, 10).map((block: Block) => {
                if (block.transactions && block.transactions.length > 0) {
                  return {
                    ...block,
                    transactions: block.transactions.map((tx: Transaction, i: number) => ({
                      ...tx,
                      transactionIndex: tx.transactionIndex !== undefined ? tx.transactionIndex : i
                    }))
                  };
                }
                return block;
              });
              
              // Set blocks and the latest block number for animation
              setBlocks(processedBlocks);
              
              // Set latest block number if there are blocks
              if (processedBlocks.length > 0) {
                setLatestBlockNumber(processedBlocks[0].number);
                
                // Start animation for this block's transaction count
                if (processedBlocks[0].transactionCount > 0) {
                  setAnimatingTransactionCounts(prev => ({
                    ...prev,
                    [processedBlocks[0].number]: 0
                  }));
                }
              }
            }
          } catch (err) {
            console.error('Error processing WebSocket message:', err);
          }
        };
      }
      
      if (ws) {
        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setWsConnected(false);
          
          // Attempt to reconnect after a delay
          setTimeout(connectWebSocket, 3000);
        };
      }
      
      } catch (error) {
        console.error('WebSocket connection error:', error);
        setWsConnected(false);
        
        // Attempt to reconnect after a delay
        setTimeout(connectWebSocket, 5000);
      }
      
      if (ws) {
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          ws?.close();
        };
      }
    };
    
    connectWebSocket();
    
    // Cleanup on unmount
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Animation effect for transaction counts
  useEffect(() => {
    // Only animate for the latest block
    if (latestBlockNumber === null) return;
    
    // Check if we have any blocks with animating transaction counts
    const animatingBlocks = Object.keys(animatingTransactionCounts);
    if (animatingBlocks.length === 0) return;
    
    // Set up animation interval
    const interval = setInterval(() => {
      setAnimatingTransactionCounts(prev => {
        const newCounts = { ...prev };
        let hasActiveAnimations = false;
        
        // Update only the latest block
        for (const blockNumber of animatingBlocks) {
          const blockNum = parseInt(blockNumber);
          const block = blocks.find(b => b.number === blockNum);
          
          if (!block) continue;
          
          // If this is not the latest block anymore, remove it from animation
          if (blockNum !== latestBlockNumber) {
            delete newCounts[blockNum];
            continue;
          }
          
          const currentValue = newCounts[blockNum];
          const targetValue = block.transactionCount;
          
          // If we've reached the target, remove this block from animation
          if (currentValue >= targetValue) {
            delete newCounts[blockNum];
          } else {
            // Use logarithmic delay function for smoother animation
            const progress = currentValue / targetValue;
            const factor = Math.log(1 + (1 - progress) * 98) / Math.log(100); 
            console.log({factor})
            const increment = Math.max(1, Math.ceil(targetValue * factor / 20));
            newCounts[blockNum] = Math.min(targetValue, currentValue + increment);
            hasActiveAnimations = true;
          }
        }
        
        // If no more animations, clear the interval
        if (!hasActiveAnimations) {
          clearInterval(interval);
          return {};
        }
        
        return newCounts;
      });
    }, 50); // Update every 50ms
    
    // Cleanup function
    return () => clearInterval(interval);
  }, [blocks, animatingTransactionCounts, latestBlockNumber]);

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };


  // Display loading state
  if (loading) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh',
          backgroundColor: 'background.default'
        }}>
          <Paper
            elevation={2}
            sx={{
              p: 4,
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2
            }}
          >
            <Box sx={{ 
              width: 40, 
              height: 40, 
              borderRadius: '50%', 
              border: '3px solid',
              borderColor: 'primary.light',
              borderTopColor: 'primary.main',
              animation: 'spin 1s linear infinite',
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' },
              }
            }} />
            <Typography variant="h6" color="text.primary">
              Loading RISE Shred Explorer...
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

  // Display error state
  if (error) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh',
          backgroundColor: 'background.default'
        }}>
          <Paper
            elevation={2}
            sx={{
              p: 4,
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2
            }}
          >
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: 'error.light',
              color: 'error.contrastText',
              fontSize: '2rem'
            }}>
              !
            </Box>
            <Typography variant="h6" color="error.main" fontWeight="medium">
              Error
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center">
              {error}
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ 
        minHeight: '100vh', 
        maxWidth: 1400, 
        mx: 'auto', 
        px: { xs: 2, sm: 3, md: 4 },
        py: 3,
      }}>
        <Box component="header" sx={{ mb: 4 }}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            mb: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            pb: 2
          }}>
            <Typography variant="h3" color="primary">RISE Shred Explorer</Typography>  
            <Chip
              size="small"
              label={wsConnected ? 'WebSocket Connected' : 'WebSocket Disconnected'}
              color={wsConnected ? 'success' : 'error'}
              variant="outlined"
              sx={{ height: 24 }}
            />        
          </Box>
      </Box>

     
      {/* Stats Cards Section */}
      <Box sx={{ mb: 5 }}>
        <Typography variant="h5" component="h2" fontWeight="medium" sx={{ mb: 2.5 }}>
          Network Statistics
        </Typography>
        <Box 
          sx={{ 
            display: 'flex', 
            flexDirection: { xs: 'column', sm: 'row' },
            flexWrap: { xs: 'nowrap', sm: 'wrap' },
            gap: 2
          }}
        >
          {/* TPS Tile */}
          <Box sx={{ 
            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)', lg: 'calc(20% - 13px)' },
            display: 'flex'
          }}>
            <Card sx={{ width: '100%' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%'
              }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  TPS
                </Typography>
                <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                  <NumberFlow trend={0} value={stats?.tps || 0} />
                </Typography>
              </CardContent>
            </Card>
          </Box>

          {/* MGas/s Tile */}
          <Box sx={{ 
            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)', lg: 'calc(20% - 13px)' },
            display: 'flex'
          }}>
            <Card sx={{ width: '100%' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%'
              }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  MGas/s
                </Typography>
                <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                  <NumberFlow value={stats ? Number((stats.gasPerSecond / 1000000).toFixed(1)) : 0} />
                </Typography>
              </CardContent>
            </Card>
          </Box>

          {/* Latest Block Tile */}
          <Box sx={{ 
            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)', lg: 'calc(20% - 13px)' },
            display: 'flex'
          }}>
            <Card sx={{ width: '100%' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%'
              }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Latest Block
                </Typography>
                <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                  <NumberFlow trend={0} value={blocks.length > 0 ? blocks[0].number : 0} />
                </Typography>
              </CardContent>
            </Card>
          </Box>

          {/* ShredTime Tile */}
          <Box sx={{ 
            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)', lg: 'calc(20% - 13px)' },
            display: 'flex'
          }}>
            <Card sx={{ width: '100%' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%'
              }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Shred Interval
                </Typography>
                <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                  {stats?.shredInterval 
                    ? <><NumberFlow value={stats.shredInterval * 1000} /> ms</> 
                    : 'N/A'}
                </Typography>
              </CardContent>
            </Card>
          </Box>
          
          {/* New Transactions Tile */}
          <Box sx={{ 
            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)', lg: 'calc(20% - 13px)' },
            display: 'flex'
          }}>
            <Card sx={{ width: '100%' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%'
              }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  New Transactions
                </Typography>
                <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                  <NumberFlow trend={-1} value={newTransactionCount} />
                </Typography>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>

      {/* Tables Section */}
      <Box sx={{ mb: 5 }}>
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          mb: 3,
          flexDirection: { xs: 'column', lg: 'row' },
          gap: { xs: 2, lg: 0 }
        }}>
          <Typography variant="h5" component="h2" fontWeight="medium">
            Explorer Data
          </Typography>
        </Box>
        
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', lg: 'row' },
          gap: 3,
          height: '100%' 
        }}>
          {/* Blocks Table */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Card sx={{ 
              display: 'flex', 
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden'
            }}>
              <Box sx={{ 
                px: 3, 
                py: 2, 
                borderBottom: 1, 
                borderColor: 'divider',
                bgcolor: 'background.paper', 
              }}>
                <Typography variant="h6" fontWeight="medium">
                  Latest Blocks
                </Typography>
              </Box>
              
              <TableContainer sx={{ 
                flexGrow: 1, 
                display: 'flex', 
                flexDirection: 'column',
                height: '100%',
                width: '100%'
              }}>
                <Table size="medium" stickyHeader sx={{ width: '100%', tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell width="20%">Number</TableCell>
                      <TableCell width="35%">Time</TableCell>
                      <TableCell width="30%">Hash</TableCell>
                      <TableCell width="15%" align="right">Txns</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {blocks.map((block) => (
                      <TableRow key={block.number}>
                        <TableCell>
                          <Typography
                            component="a"
                            href={`https://explorer.testnet.riselabs.xyz/block/${block.number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ 
                              color: 'primary.main', 
                              fontWeight: 500,
                              textDecoration: 'none', 
                              '&:hover': { textDecoration: 'underline' } 
                            }}
                          >
                            {block.number}
                          </Typography>
                        </TableCell>
                        <TableCell>{formatTimestamp(block.timestamp)}</TableCell>
                        <TableCell>
                          <Typography 
                            sx={{ 
                              fontFamily: 'monospace', 
                              fontSize: '0.85rem',
                              color: 'text.secondary',
                              display: 'inline-block',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {block.hash.substring(0, 14)}...
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Box 
                            sx={{ 
                              fontWeight: block.number === latestBlockNumber ? 600 : 400,
                              color: block.number === latestBlockNumber ? 'primary.main' : 'inherit',
                            }}
                          >
                            {animatingTransactionCounts[block.number] !== undefined ? 
                              animatingTransactionCounts[block.number] : block.transactionCount}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                    {blocks.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center">No blocks available</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>

          {/* Latest Transactions Table */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Card sx={{ 
              display: 'flex', 
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden'
            }}>
              <Box sx={{ 
                px: 3, 
                py: 2, 
                borderBottom: 1, 
                borderColor: 'divider',
                bgcolor: 'background.paper', 
              }}>
                <Typography variant="h6" fontWeight="medium">
                  Latest Transactions
                </Typography>
              </Box>
              
              <TableContainer sx={{ 
                flexGrow: 1, 
                display: 'flex', 
                flexDirection: 'column',
                height: '100%',
                width: '100%'
              }}>
                <Table size="medium" stickyHeader sx={{ width: '100%', tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell width="35%">Hash</TableCell>
                      <TableCell width="20%">Block</TableCell>
                      <TableCell width="15%" align="center">Index</TableCell>
                      <TableCell width="30%" align="right">Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {/* Move useMemo hook outside of the render function */}
                    {getTransactionRows(blocks)}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>
        </Box>
      </Box>

      <Box component="footer" sx={{ mt: 8, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} RISE Shred Explorer
        </Typography>
      </Box>
    </Box>
    </ThemeProvider>
  );
}