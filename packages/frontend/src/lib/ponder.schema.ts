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
    createdAt: t.timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: t.timestamp().notNull().$defaultFn(() => new Date()),
  }),
  (table) => ({
    parentHashIdx: index().on(table.parentHash),
    timestampIdx: index().on(table.timestamp),
  })
);

export const transaction = onchainTable(
  "transaction",
  (t) => ({
    hash: t.text().primaryKey(),
    blockNumber: t.bigint().notNull(),
    blockHash: t.text().notNull(),
    transactionIndex: t.integer().notNull(),
    from: t.text(),
    to: t.text(),
    value: t.text().notNull(),
    gasLimit: t.bigint(),
    gasUsed: t.bigint(),
    gasPrice: t.bigint(),
    maxFeePerGas: t.bigint(),
    maxPriorityFeePerGas: t.bigint(),
    nonce: t.bigint(),
    input: t.text(),
    type: t.text(),
    createdAt: t.timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: t.timestamp().notNull().$defaultFn(() => new Date()),
  }),
  (table) => ({
    blockNumberIdx: index().on(table.blockNumber),
    blockHashIdx: index().on(table.blockHash),
    fromIdx: index().on(table.from),
    toIdx: index().on(table.to),
    transactionIndexIdx: index().on(table.transactionIndex),
  })
);

export const tenBlockStat = onchainTable("tenBlockStat", (t) => ({
  headNumber: t.bigint().primaryKey(),
  totalTransactions: t.integer().notNull(),
  totalGas: t.bigint().notNull(),
  totalTimeSeconds: t.integer().notNull(),
  headTimestamp: t.bigint().notNull(),
}));
