"use client";

import { useState, useEffect, useMemo } from "react";
import { usePonderQuery } from "@ponder/react";
import { blocksQueryOptions, statsQueryOptions } from "../lib/ponder";
import { getPonderQueryOptions } from "@ponder/react";
import { createClient, desc, eq } from "@ponder/client";
import * as schema from "../lib/ponder.schema";

// Get the Ponder server URL from environment variables
const PONDER_URL =
  process.env.NEXT_PUBLIC_PONDER_URL || "http://localhost:42069";

const client = createClient(`${PONDER_URL}/sql`, { schema });

interface Block {
  number: bigint;
  hash: string;
  parentHash: string;
  timestamp: bigint;
  transactionCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  miner: string;
  difficulty: bigint;
  totalDifficulty: bigint | null;
  size: bigint;
  transactionsRoot: string;
  stateRoot: string;
  receiptsRoot: string;
  extraData: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Transaction {
  hash: string;
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;
  from: string | null;
  to: string | null;
  value: string;
  gasLimit: bigint | null;
  gasUsed: bigint | null;
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  nonce: bigint | null;
  input: string | null;
  type: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export function useSynchronizedData(): SynchronizedData {
  const [blockCache, setBlockCache] = useState<Map<string, Block>>(new Map());
  const [stableTransactions, setStableTransactions] = useState<Transaction[]>([]);

  // Blocks query with automatic polling
  const blocksQuery = usePonderQuery({
    ...blocksQueryOptions,
    refetchInterval: 1000, // Poll every 1 second
  });

  // Stats query with automatic polling
  const statsQuery = usePonderQuery({
    ...statsQueryOptions,
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Get latest block number from blocks data
  const latestBlockNumber = useMemo(() => {
    if (!blocksQuery.data || blocksQuery.data.length === 0) return null;
    return blocksQuery.data[0].number;
  }, [blocksQuery.data]);

  // Transaction query options that depend on latest block
  const transactionQueryOptions = useMemo(() => 
    getPonderQueryOptions(client, (db) =>
      latestBlockNumber
        ? db
            .select()
            .from(schema.transaction)
            .where(eq(schema.transaction.blockNumber, latestBlockNumber))
            .orderBy(desc(schema.transaction.transactionIndex))
            .limit(10)
        : db
            .select()
            .from(schema.transaction)
            .orderBy(desc(schema.transaction.blockNumber), desc(schema.transaction.transactionIndex))
            .limit(10)
    ), [latestBlockNumber]);

  // Transactions query with automatic polling
  const transactionsQuery = usePonderQuery({
    ...transactionQueryOptions,
    enabled: latestBlockNumber !== null,
    refetchInterval: 1000, // Poll every 1 second
  });

  // Update block cache when blocks change
  useEffect(() => {
    if (blocksQuery.data) {
      const newBlockMap = new Map<string, Block>();
      
      blocksQuery.data.forEach((block) => {
        newBlockMap.set(block.number.toString(), block);
      });

      setBlockCache(newBlockMap);
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log('🔄 Blocks updated:', blocksQuery.data.length, 'blocks, latest:', blocksQuery.data[0]?.number?.toString());
      }
    }
  }, [blocksQuery.data]);

  // Update stable transactions when transaction data changes (prevents flickering)
  useEffect(() => {
    if (transactionsQuery.data) {
      setStableTransactions(transactionsQuery.data);
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log('💸 Transactions updated:', transactionsQuery.data.length, 'transactions for block:', latestBlockNumber?.toString());
      }
    }
  }, [transactionsQuery.data, latestBlockNumber]);

  // Compute stats data
  const statsData = useMemo(() => {
    if (!statsQuery.data) return null;
    
    const [ten] = statsQuery.data;
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
  }, [statsQuery.data]);

  // Get stats-based latest block number
  const statsLatestBlockNumber = useMemo(() => {
    return statsQuery.data?.[0]?.headNumber || null;
  }, [statsQuery.data]);

  // Return synchronized data
  return {
    blocks: blocksQuery.data || [],
    transactions: stableTransactions,
    stats: statsData,
    latestBlockNumber: statsLatestBlockNumber,
    isLoading: blocksQuery.isPending || statsQuery.isPending,
    isError: blocksQuery.isError || statsQuery.isError || transactionsQuery.isError,
    error: blocksQuery.error || statsQuery.error || transactionsQuery.error,
    lastUpdate: Date.now(),
  };
}