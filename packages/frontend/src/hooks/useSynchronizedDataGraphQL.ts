"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@apollo/client";
import { GET_SYNCHRONIZED_DATA } from "../lib/graphql/queries";

interface Block {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
  miner: string;
  difficulty: string;
  totalDifficulty: string | null;
  size: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptsRoot: string;
  extraData: string;
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  hash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: number;
  from: string | null;
  to: string | null;
  value: string;
  gasLimit: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  nonce: string | null;
  input: string | null;
  type: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TenBlockStat {
  headNumber: string;
  totalTransactions: number;
  totalGas: string;
  totalTimeSeconds: number;
  headTimestamp: string;
}

interface Stats {
  tps: number;
  shredInterval?: number;
  gasPerSecond: number;
  windowSize: number;
  lastUpdate?: number;
}

interface SynchronizedData {
  blocks: Block[];
  transactions: Transaction[];
  stats: Stats | null;
  latestBlockNumber: bigint | null;
  isLoading: boolean;
  isError: boolean;
  error: any;
  lastUpdate: number;
}

interface QueryData {
  blocks: {
    items: Block[];
  };
  tenBlockStats: {
    items: TenBlockStat[];
  };
  transactions: {
    items: Transaction[];
  };
}

export function useSynchronizedDataGraphQL(): SynchronizedData {
  const [stableTransactions, setStableTransactions] = useState<Transaction[]>([]);

  // GraphQL query with polling
  const { data, loading, error } = useQuery<QueryData>(GET_SYNCHRONIZED_DATA, {
    variables: {
      blocksLimit: 10,
      transactionsLimit: 50,
    },
    pollInterval: 1000, // Poll every 1 second
    fetchPolicy: 'cache-and-network',
  });

  // Update stable transactions when data changes (prevents flickering)
  useEffect(() => {
    if (data?.transactions?.items) {
      setStableTransactions(data.transactions.items);
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log('💸 Transactions updated:', data.transactions.items.length, 'transactions');
      }
    }
  }, [data?.transactions?.items]);

  // Compute stats data
  const statsData = useMemo(() => {
    if (!data?.tenBlockStats?.items?.[0]) return null;
    
    const ten = data.tenBlockStats.items[0];
    const stats: Stats = {
      gasPerSecond: Number(ten.totalGas) / ten.totalTimeSeconds,
      tps: Math.round(ten.totalTransactions / ten.totalTimeSeconds),
      windowSize: 10,
      lastUpdate: Date.now(),
      shredInterval: ten.totalTimeSeconds / ten.totalTransactions,
    };

    // Debug logging
    if (process.env.NODE_ENV === 'development') {
      console.log('📊 Stats updated - TPS:', stats.tps, 'Gas/sec:', stats.gasPerSecond.toFixed(0));
    }

    return stats;
  }, [data?.tenBlockStats?.items]);

  // Get latest block number
  const latestBlockNumber = useMemo(() => {
    if (data?.tenBlockStats?.items?.[0]?.headNumber) {
      return BigInt(data.tenBlockStats.items[0].headNumber);
    }
    if (data?.blocks?.items?.[0]?.number) {
      return BigInt(data.blocks.items[0].number);
    }
    return null;
  }, [data]);

  // Debug logging for blocks
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && data?.blocks?.items?.length) {
      console.log('🔄 Blocks updated:', data.blocks.items.length, 'blocks, latest:', data.blocks.items[0]?.number);
    }
  }, [data?.blocks?.items]);

  // Return synchronized data
  return {
    blocks: data?.blocks?.items || [],
    transactions: stableTransactions,
    stats: statsData,
    latestBlockNumber,
    isLoading: loading,
    isError: !!error,
    error,
    lastUpdate: Date.now(),
  };
}