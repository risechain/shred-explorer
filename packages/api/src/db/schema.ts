import { pgTable, serial, bigint, timestamp, integer, text, unique, doublePrecision, jsonb } from 'drizzle-orm/pg-core';

// Blocks table based on new indexer schema
export const blocks = pgTable('blocks', {
  number: bigint('number', { mode: 'number' }).primaryKey(),
  hash: text('hash').notNull().unique(),
  parentHash: text('parent_hash').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  transactionsRoot: text('transactions_root').notNull(),
  stateRoot: text('state_root').notNull(),
  receiptsRoot: text('receipts_root').notNull(),
  gasUsed: bigint('gas_used', { mode: 'number' }).notNull(),
  gasLimit: bigint('gas_limit', { mode: 'number' }).notNull(),
  baseFeePerGas: bigint('base_fee_per_gas', { mode: 'number' }),
  extraData: text('extra_data').notNull(),
  miner: text('miner').notNull(),
  difficulty: text('difficulty').notNull(),
  totalDifficulty: text('total_difficulty').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  transactionCount: bigint('transaction_count', { mode: 'number' }).notNull(),
  transactions: jsonb('transactions'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Types for transactions in the jsonb field
export interface TransactionJson {
  hash: string;
  value: string;
  from?: string;
  to?: string;
}

// Export types for use in the application
export type Block = typeof blocks.$inferSelect;

// Computed fields and stats that we'll calculate from block data
export interface BlockStats {
  tps: number; // average transactions per second
  shredInterval?: number; // average time (in ms) per shred
  gasPerSecond: number; // average gas used per second
}