import { index, onchainTable } from "ponder";

export const block = onchainTable(
  "block",
  (t) => ({
    number: t.bigint().primaryKey(),
    hash: t.text().notNull(),
    parentHash: t.text().notNull(),
    timestamp: t.bigint().notNull(),
    transactionsRoot: t.text().notNull(),
    stateRoot: t.text().notNull(),
    receiptsRoot: t.text().notNull(),
    gasUsed: t.bigint().notNull(),
    gasLimit: t.bigint().notNull(),
    baseFeePerGas: t.bigint(),
    extraData: t.text().notNull(),
    miner: t.text().notNull(),
    difficulty: t.bigint().notNull(),
    totalDifficulty: t.bigint(),
    size: t.bigint().notNull(),
    transactionCount: t.integer().notNull(),
    transactions: t.jsonb(),
    createdAt: t.timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: t.timestamp().notNull().$defaultFn(() => new Date()),
  }),
  (table) => ({
    parentHashIdx: index().on(table.parentHash),
    timestampIdx: index().on(table.timestamp),
  })
);

export const tenBlockStat = onchainTable("tenBlockStat", (t) => ({
  headNumber: t.bigint().primaryKey(),
  totalTransactions: t.integer().notNull(),
  totalGas: t.bigint().notNull(),
  totalTimeSeconds: t.integer().notNull(),
  headTimestamp: t.bigint().notNull(),
}));
