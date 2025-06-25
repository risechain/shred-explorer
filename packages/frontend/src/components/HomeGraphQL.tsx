"use client";

import { useEffect, useState, useCallback } from "react";
import NumberFlow from "@number-flow/react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  ThemeProvider,
  createTheme,
  CssBaseline,
} from "@mui/material";
import { useSynchronizedDataGraphQL } from "../hooks/useSynchronizedDataGraphQL";
import { formatUnits } from "viem";

// Types
interface Transaction {
  hash: string;
  from?: string | null;
  to?: string | null;
  value: string;
  transactionIndex: number;
}

// Create a theme (matching original)
const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#3f51b5",
    },
    secondary: {
      main: "#f50057",
    },
    background: {
      default: "#f5f5f7",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily:
      'var(--font-geist-sans), "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h3: {
      fontWeight: 700,
      fontSize: "1.75rem",
    },
    h4: {
      fontWeight: 600,
      fontSize: "1.5rem",
    },
    h5: {
      fontWeight: 600,
      fontSize: "1.25rem",
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          transition: "box-shadow 0.3s ease-in-out",
          "&:hover": {
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: "16px 20px",
          "&:last-child": {
            paddingBottom: 16,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "12px 16px",
          borderColor: "rgba(224, 224, 224, 0.5)",
        },
        head: {
          fontWeight: 600,
          backgroundColor: "rgba(0, 0, 0, 0.03)",
        },
      },
    },
  },
});

// Helper function for timestamps
function formatRelativeTime(timestamp: bigint | string): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const time = typeof timestamp === 'string' ? BigInt(timestamp) : timestamp;
  const diff = now - time;

  if (diff < BigInt(60)) return `${diff}s ago`;
  if (diff < BigInt(3600)) return `${diff / BigInt(60)}m ago`;
  if (diff < BigInt(86400)) return `${diff / BigInt(3600)}h ago`;
  return `${diff / BigInt(86400)}d ago`;
}

// Helper functions
function formatNumber(num: number | bigint | string | null | undefined): string {
  if (num === null || num === undefined) return "0";
  const value = typeof num === 'string' ? BigInt(num) : num;
  return value.toLocaleString();
}

function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatHash(hash: string): string {
  if (!hash) return "";
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatEth(value: string | bigint): string {
  const bigValue = typeof value === 'string' ? BigInt(value) : value;
  const eth = formatUnits(bigValue, 18);
  const num = parseFloat(eth);
  if (num === 0) return "0 ETH";
  if (num < 0.0001) return "<0.0001 ETH";
  return `${num.toFixed(4)} ETH`;
}

export default function HomeGraphQL() {
  const [totalTransactions, setTotalTransactions] = useState<number | null>(null);
  const [baseTransactionCount, setBaseTransactionCount] = useState<number | null>(null);
  const [cumulativeNewTransactions, setCumulativeNewTransactions] = useState<number>(0);
  const [lastProcessedBlock, setLastProcessedBlock] = useState<string | null>(null);
  const [latestBlockNumberState, setLatestBlockNumberState] = useState<number | null>(null);
  const [animatingTransactionCounts, setAnimatingTransactionCounts] = useState<Record<string, number>>({});

  // Use synchronized data hook
  const {
    blocks: blockData,
    transactions: transactionData,
    stats: statsData,
    latestBlockNumber,
    isLoading: dataLoading,
    isError: dataError,
    error: error,
    lastUpdate,
  } = useSynchronizedDataGraphQL();

  // Derive individual loading states for backward compatibility
  const blockPending = dataLoading;
  const statsPending = dataLoading;
  const blockIsError = dataError;
  const statsIsError = dataError;
  const blockError = error;
  const statsError = error;

  // Update latest block number from stats
  useEffect(() => {
    if (latestBlockNumber) {
      setLatestBlockNumberState(Number(latestBlockNumber));
    }
  }, [latestBlockNumber]);

  // Track cumulative new transactions
  useEffect(() => {
    const latestBlock = blockData?.[0];

    if (!latestBlock) return;

    // If this is a new block we haven't processed yet
    if (lastProcessedBlock === null || latestBlock.number > lastProcessedBlock) {
      // Add the transactions from this new block to our cumulative count
      setCumulativeNewTransactions(prev => prev + latestBlock.transactionCount);
      setLastProcessedBlock(latestBlock.number);
    }
  }, [blockData, lastProcessedBlock]);

  // Fetch total transactions from external API
  const fetchTotalTransactions = useCallback(async () => {
    try {
      const response = await fetch(
        "https://explorer.testnet.riselabs.xyz/api/v2/stats"
      );
      if (!response.ok) {
        console.error("Failed to fetch total transactions from external API");
        return;
      }

      const data = await response.json();
      console.log(data);
      if (data && typeof data.total_transactions === "string") {
        const totalFromAPI = Number(data.total_transactions);
        setTotalTransactions(totalFromAPI);
        
        // If this is our first fetch, set it as the base count
        if (baseTransactionCount === null) {
          setBaseTransactionCount(totalFromAPI);
        }
      } else {
        console.warn(
          "External API response does not include totalTransactions field",
          data
        );
      }
    } catch (err) {
      console.error("Error fetching total transactions:", err);
    }
  }, [baseTransactionCount]);

  // Fetch initial data
  useEffect(() => {
    // Fetch immediately on mount
    fetchTotalTransactions();
    
    // Set up periodic refresh for total transactions
    const intervalId = setInterval(fetchTotalTransactions, 60000); // Refresh every minute

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchTotalTransactions]);

  // Animation effect for transaction counts
  useEffect(() => {
    // Only animate for the latest block
    if (latestBlockNumberState === null) return;

    // Check if we have any blocks with animating transaction counts
    const animatingBlocks = Object.keys(animatingTransactionCounts);
    if (animatingBlocks.length === 0) return;

    if (!blockData) return;

    // Set up animation interval
    const interval = setInterval(() => {
      setAnimatingTransactionCounts((prev) => {
        const newCounts = { ...prev };
        let hasChanges = false;

        Object.keys(newCounts).forEach((blockNumber) => {
          const block = blockData.find((b) => b.number === blockNumber);
          if (!block) {
            delete newCounts[blockNumber];
            hasChanges = true;
            return;
          }

          const currentCount = newCounts[blockNumber];
          const targetCount = block.transactionCount;

          if (currentCount < targetCount) {
            const increment = Math.max(1, Math.floor((targetCount - currentCount) / 10));
            newCounts[blockNumber] = Math.min(currentCount + increment, targetCount);
            hasChanges = true;
          } else if (currentCount === targetCount) {
            delete newCounts[blockNumber];
            hasChanges = true;
          }
        });

        return hasChanges ? newCounts : prev;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [animatingTransactionCounts, blockData, latestBlockNumberState]);

  // Calculate displayed total transactions
  const displayedTotalTransactions = baseTransactionCount !== null 
    ? baseTransactionCount + cumulativeNewTransactions 
    : totalTransactions;

  // Error states (matching original structure)
  if (blockIsError || statsIsError) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: "100vh",
            maxWidth: 1400,
            mx: "auto",
            px: { xs: 2, sm: 3, md: 4 },
            py: 3,
          }}
        >
          <Paper elevation={1} sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="h5" color="error" gutterBottom>
              Error Loading Data
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center">
              {blockError?.message || statsError?.message || "An error occurred while loading data"}
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

  // Stats data
  const tps = statsData?.tps || 0;
  const shredInterval = statsData?.shredInterval || 0;
  const gasPerSecond = statsData?.gasPerSecond || 0;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          maxWidth: 1400,
          mx: "auto",
          px: { xs: 2, sm: 3, md: 4 },
          py: 3,
        }}
      >
        <Box component="header" sx={{ mb: 4 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
              borderBottom: "1px solid",
              borderColor: "divider",
              pb: 2,
            }}
          >
            <Typography variant="h3" color="primary">
              RISE Shred Explorer
            </Typography>
            <Chip
              size="small"
              label={blockPending || statsPending ? "Connecting" : "Connected"}
              color={blockPending || statsPending ? "error" : "success"}
              variant="outlined"
              sx={{ height: 24 }}
            />
          </Box>
        </Box>

        {/* Stats Cards Section */}
        <Box sx={{ mb: 5 }}>
          <Typography
            variant="h5"
            sx={{ mb: 3, color: "text.primary", fontWeight: 600 }}
          >
            Network Statistics
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
                md: "repeat(3, 1fr)",
                lg: "repeat(5, 1fr)",
              },
              gap: 2,
            }}
          >
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  TPS
                </Typography>
                <Typography variant="h5">
                  <NumberFlow
                    value={tps}
                    format={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }}
                    trend={1}
                  />
                </Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Shred Interval
                </Typography>
                <Typography variant="h5">
                  <NumberFlow
                    value={shredInterval}
                    suffix="s"
                    format={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    }}
                    trend={-1}
                  />
                </Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  MGas/s
                </Typography>
                <Typography variant="h5">
                  <NumberFlow
                    value={gasPerSecond / 1_000_000}
                    format={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 1,
                    }}
                    trend={1}
                  />
                </Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Latest Block
                </Typography>
                <Typography variant="h5">
                  <NumberFlow
                    value={latestBlockNumberState || 0}
                    format={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }}
                  />
                </Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Total Txs
                </Typography>
                <Typography variant="h5">
                  <NumberFlow
                    value={displayedTotalTransactions || 0}
                    format={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }}
                  />
                </Typography>
              </CardContent>
            </Card>
          </Box>
        </Box>

        {/* Content Grid */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
            gap: 3,
          }}
        >
          {/* Latest Blocks */}
          <Card>
            <CardContent>
              <Typography variant="h5" gutterBottom>
                Latest Blocks
              </Typography>
              <TableContainer component={Paper} elevation={0}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Block</TableCell>
                      <TableCell>Age</TableCell>
                      <TableCell align="right">Txns</TableCell>
                      <TableCell align="right">Gas Used</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {blockPending ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : (
                      blockData?.map((block) => (
                        <TableRow
                          key={block.number}
                          sx={{
                            "&:hover": { backgroundColor: "action.hover" },
                          }}
                        >
                          <TableCell>
                            <Typography variant="body2" fontFamily="var(--font-geist-mono)">
                              {formatNumber(block.number)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {formatRelativeTime(block.timestamp)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontFamily="var(--font-geist-mono)">
                              <NumberFlow
                                value={
                                  animatingTransactionCounts[block.number] !== undefined
                                    ? animatingTransactionCounts[block.number]
                                    : block.transactionCount
                                }
                                format={{
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                }}
                              />
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontFamily="var(--font-geist-mono)">
                              {formatNumber(
                                Math.round(Number(block.gasUsed) / 1_000_000)
                              )}{" "}
                              M
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          {/* Latest Transactions */}
          <Card>
            <CardContent>
              <Typography variant="h5" gutterBottom>
                Latest Transactions
              </Typography>
              <TableContainer component={Paper} elevation={0}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tx Hash</TableCell>
                      <TableCell>From</TableCell>
                      <TableCell>To</TableCell>
                      <TableCell align="right">Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {blockPending ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : transactionData?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          <Typography variant="body2" color="text.secondary">
                            No transactions in recent blocks
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactionData?.slice(0, 10).map((tx: Transaction) => (
                        <TableRow
                          key={`${tx.hash}-${tx.transactionIndex}`}
                          sx={{
                            "&:hover": { backgroundColor: "action.hover" },
                          }}
                        >
                          <TableCell>
                            <Typography
                              variant="body2"
                              fontFamily="var(--font-geist-mono)"
                              sx={{ color: "primary.main" }}
                            >
                              {formatHash(tx.hash)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              fontFamily="var(--font-geist-mono)"
                            >
                              {tx.from ? formatAddress(tx.from) : "N/A"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              fontFamily="var(--font-geist-mono)"
                            >
                              {tx.to ? formatAddress(tx.to) : "Contract Creation"}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography
                              variant="body2"
                              fontFamily="var(--font-geist-mono)"
                            >
                              {formatEth(tx.value)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </ThemeProvider>
  );
}