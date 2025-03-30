import { pgTable, serial, bigint, timestamp, integer, text, unique, doublePrecision, jsonb } from 'drizzle-orm/pg-core';

// Shreds table
export const shreds = pgTable('shreds', {
  id: serial('id').primaryKey(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  shredIdx: bigint('shred_idx', { mode: 'number' }).notNull(),
  transactionCount: integer('transaction_count').notNull(),
  stateChangeCount: integer('state_change_count').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  shredInterval: bigint('shred_interval', { mode: 'number' }),
}, (table) => ({
  blockShredUnique: unique().on(table.blockNumber, table.shredIdx),
}));

// Transactions table
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  shredId: bigint('shred_id', { mode: 'number' }).notNull().references(() => shreds.id),
  transactionData: jsonb('transaction_data').notNull(),
  receiptData: jsonb('receipt_data').notNull(),
});

// State changes table
export const stateChanges = pgTable('state_changes', {
  id: serial('id').primaryKey(),
  shredId: bigint('shred_id', { mode: 'number' }).notNull().references(() => shreds.id),
  address: text('address').notNull(),
  nonce: bigint('nonce', { mode: 'number' }).notNull(),
  balance: text('balance').notNull(),
  code: text('code').notNull(),
  storage: jsonb('storage').notNull(),
});

// Blocks table
export const blocks = pgTable('blocks', {
  number: bigint('number', { mode: 'number' }).primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  transactionCount: integer('transaction_count').default(0).notNull(),
  shredCount: integer('shred_count').default(0).notNull(),
  stateChangeCount: integer('state_change_count').default(0).notNull(),
  firstShredId: bigint('first_shred_id', { mode: 'number' }).references(() => shreds.id),
  lastShredId: bigint('last_shred_id', { mode: 'number' }).references(() => shreds.id),
  blockTime: bigint('block_time', { mode: 'number' }),
  avgTps: doublePrecision('avg_tps'),
  avgShredInterval: doublePrecision('avg_shred_interval'),
});

// Export types for use in the application
export type Block = typeof blocks.$inferSelect;
export type Shred = typeof shreds.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type StateChange = typeof stateChanges.$inferSelect;