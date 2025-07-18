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
import { useSynchronizedData } from "../hooks/useSynchronizedData";
import { formatUnits } from "viem";

// Types

interface Transaction {
  hash: string;
  from?: string;
  to?: string;
  value: string;
  transactionIndex: number;
}


// Create a theme
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
      default: "#f5f5f7", // Light gray background for better contrast
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
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: "background-color 0.2s ease",
          "&:hover": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        },
      },
    },
  },
});

// Helper function to generate transaction rows from separate transaction data
// to avoid React hooks rules violations (can't use hooks conditionally)
function getTransactionRows(transactions: any[] | undefined) {
  // Display transactions
  if (transactions && transactions.length > 0) {
    return transactions.slice(0, 10).map((tx) => (
      <TableRow key={tx.hash}>
        <TableCell>
          <Typography
            component="a"
            href={`https://explorer.testnet.riselabs.xyz/tx/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              fontFamily: "monospace",
              fontSize: "0.85rem",
              color: "primary.main",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
              display: "inline-block",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tx.hash?.substring(0, 14) || "0x..."}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography
            component="a"
            href={`https://explorer.testnet.riselabs.xyz/block/${Number(tx.blockNumber)}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: "primary.main",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {Number(tx.blockNumber) || "N/A"}
          </Typography>
        </TableCell>
        <TableCell align="center">
          {tx.transactionIndex !== undefined ? tx.transactionIndex : "N/A"}
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: "monospace" }}>
          {(parseInt(tx.value || "0") / 1e18).toFixed(4)} ETH
        </TableCell>
      </TableRow>
    ));
  } else {
    return (
      <TableRow>
        <TableCell colSpan={4} align="center">
          No transactions available
        </TableCell>
      </TableRow>
    );
  }
}

export default function Home() {
  // State hooks
  const [cumulativeNewTransactions, setCumulativeNewTransactions] = useState(0);
  const [baseTransactionCount, setBaseTransactionCount] = useState<number | null>(null);
  const [lastProcessedBlock, setLastProcessedBlock] = useState<bigint | null>(null);
  const [totalTransactions, setTotalTransactions] = useState<number | null>(
    null
  );
  const [latestBlockNumberState, setLatestBlockNumberState] = useState<number | null>(
    null
  );
  const [animatingTransactionCounts, setAnimatingTransactionCounts] = useState<{
    [blockNumber: number]: number;
  }>({});

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
  } = useSynchronizedData();

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
  }, []);

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
        let hasActiveAnimations = false;

        // Update only the latest block
        for (const blockNumber of animatingBlocks) {
          const blockNum = parseInt(blockNumber);
          const block = blockData.find((b) => b.number === BigInt(blockNum));

          if (!block) continue;

          // If this is not the latest block anymore, remove it from animation
          if (blockNum !== latestBlockNumberState) {
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
            const increment = Math.max(
              1,
              Math.ceil((targetValue * factor) / 20)
            );
            newCounts[blockNum] = Math.min(
              targetValue,
              currentValue + increment
            );
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
  }, [blockData, animatingTransactionCounts, latestBlockNumberState]);

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Display loading state
  if (blockPending || statsPending) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            backgroundColor: "background.default",
          }}
        >
          <Paper
            elevation={2}
            sx={{
              p: 4,
              borderRadius: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "3px solid",
                borderColor: "primary.light",
                borderTopColor: "primary.main",
                animation: "spin 1s linear infinite",
                "@keyframes spin": {
                  "0%": { transform: "rotate(0deg)" },
                  "100%": { transform: "rotate(360deg)" },
                },
              }}
            />
            <Typography variant="h6" color="text.primary">
              Loading RISE Shred Explorer...
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

  // Display error state
  if (blockIsError || statsIsError) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            backgroundColor: "background.default",
          }}
        >
          <Paper
            elevation={2}
            sx={{
              p: 4,
              borderRadius: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                backgroundColor: "error.light",
                color: "error.contrastText",
                fontSize: "2rem",
              }}
            >
              !
            </Box>
            <Typography variant="h6" color="error.main" fontWeight="medium">
              Error
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center">
              {blockError?.message || statsError?.message || "An error occurred while loading data"}
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

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
            component="h2"
            fontWeight="medium"
            sx={{ mb: 2.5 }}
          >
            Network Statistics
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              flexWrap: { xs: "nowrap", sm: "wrap" },
              gap: 2,
            }}
          >
            {/* TPS Tile */}
            <Box
              sx={{
                width: {
                  xs: "100%",
                  sm: "calc(50% - 8px)",
                  md: "calc(33.33% - 11px)",
                  lg: "calc(20% - 13px)",
                },
                display: "flex",
              }}
            >
              <Card sx={{ width: "100%" }}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    TPS
                  </Typography>
                  <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                    <NumberFlow trend={0} value={statsData?.tps || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* MGas/s Tile */}
            <Box
              sx={{
                width: {
                  xs: "100%",
                  sm: "calc(50% - 8px)",
                  md: "calc(33.33% - 11px)",
                  lg: "calc(20% - 13px)",
                },
                display: "flex",
              }}
            >
              <Card sx={{ width: "100%" }}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    MGas/s
                  </Typography>
                  <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                    <NumberFlow
                      value={
                        statsData
                          ? Number(
                              (statsData.gasPerSecond / 1000000).toFixed(1)
                            )
                          : 0
                      }
                    />
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* Latest Block Tile */}
            <Box
              sx={{
                width: {
                  xs: "100%",
                  sm: "calc(50% - 8px)",
                  md: "calc(33.33% - 11px)",
                  lg: "calc(20% - 13px)",
                },
                display: "flex",
              }}
            >
              <Card sx={{ width: "100%" }}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Latest Block
                  </Typography>
                  <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                    <NumberFlow
                      trend={0}
                      value={
                        blockData.length > 0 ? Number(blockData[0].number) : 0
                      }
                    />
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* ShredTime Tile */}
            <Box
              sx={{
                width: {
                  xs: "100%",
                  sm: "calc(50% - 8px)",
                  md: "calc(33.33% - 11px)",
                  lg: "calc(20% - 13px)",
                },
                display: "flex",
              }}
            >
              <Card sx={{ width: "100%" }}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Shred Interval
                  </Typography>
                  <Typography variant="h4" component="div" sx={{ mt: 1 }}>
                    {statsData?.shredInterval ? (
                      <>
                        <NumberFlow value={statsData.shredInterval * 1000} /> ms
                      </>
                    ) : (
                      "N/A"
                    )}
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* Transactions Tile */}
            <Box
              sx={{
                width: {
                  xs: "100%",
                  sm: "calc(50% - 8px)",
                  md: "calc(33.33% - 11px)",
                  lg: "calc(20% - 13px)",
                },
                display: "flex",
              }}
            >
              <Card sx={{ width: "100%" }}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Total Transactions
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="h4" component="div">
                      <NumberFlow
                        trend={1}
                        value={
                          totalTransactions !== null
                            ? totalTransactions + cumulativeNewTransactions
                            : cumulativeNewTransactions
                        }
                      />
                    </Typography>
                    {totalTransactions !== null && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5, fontSize: "0.75rem" }}
                      >
                        +{cumulativeNewTransactions.toLocaleString()} new
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Box>
          </Box>
        </Box>

        {/* Tables Section */}
        <Box sx={{ mb: 5 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              mb: 3,
              flexDirection: { xs: "column", lg: "row" },
              gap: { xs: 2, lg: 0 },
            }}
          >
            <Typography variant="h5" component="h2" fontWeight="medium">
              Explorer Data
            </Typography>
          </Box>

          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", lg: "row" },
              gap: 3,
              height: "100%",
            }}
          >
            {/* Blocks Table */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <Card
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    px: 3,
                    py: 2,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                  }}
                >
                  <Typography variant="h6" fontWeight="medium">
                    Latest Blocks
                  </Typography>
                </Box>

                <TableContainer
                  sx={{
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    width: "100%",
                  }}
                >
                  <Table
                    size="medium"
                    stickyHeader
                    sx={{ width: "100%", tableLayout: "fixed" }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell width="20%">Number</TableCell>
                        <TableCell width="35%">Time</TableCell>
                        <TableCell width="30%">Hash</TableCell>
                        <TableCell width="15%" align="right">
                          Txns
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {blockData.map((block) => (
                        <TableRow key={block.number}>
                          <TableCell>
                            <Typography
                              component="a"
                              href={`https://explorer.testnet.riselabs.xyz/block/${block.number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{
                                color: "primary.main",
                                fontWeight: 500,
                                textDecoration: "none",
                                "&:hover": { textDecoration: "underline" },
                              }}
                            >
                              {block.number?.toString() || "N/A"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {formatTimestamp(Number(block.timestamp))}
                          </TableCell>
                          <TableCell>
                            <Typography
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.85rem",
                                color: "text.secondary",
                                display: "inline-block",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {block.hash?.substring(0, 14) || "0x..."}...
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Box
                              sx={{
                                fontWeight:
                                  Number(block.number) === latestBlockNumberState
                                    ? 600
                                    : 400,
                                color:
                                  Number(block.number) === latestBlockNumberState
                                    ? "primary.main"
                                    : "inherit",
                              }}
                            >
                              {animatingTransactionCounts[
                                Number(block.number)
                              ] !== undefined
                                ? animatingTransactionCounts[
                                    Number(block.number)
                                  ]
                                : block.transactionCount}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                      {blockData.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            No blocks available
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            </Box>

            {/* Latest Transactions Table */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <Card
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    px: 3,
                    py: 2,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                  }}
                >
                  <Typography variant="h6" fontWeight="medium">
                    Latest Transactions
                  </Typography>
                </Box>

                <TableContainer
                  sx={{
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    width: "100%",
                  }}
                >
                  <Table
                    size="medium"
                    stickyHeader
                    sx={{ width: "100%", tableLayout: "fixed" }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell width="35%">Hash</TableCell>
                        <TableCell width="20%">Block</TableCell>
                        <TableCell width="15%" align="center">
                          Index
                        </TableCell>
                        <TableCell width="30%" align="right">
                          Value
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {/* Use separate transaction data */}
                      {getTransactionRows(transactionData)}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            </Box>
          </Box>
        </Box>

        <Box component="footer" sx={{ mt: 8, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            © {new Date().getFullYear()} RISE Shred Explorer
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
