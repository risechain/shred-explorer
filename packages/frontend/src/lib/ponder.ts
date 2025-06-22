import { createClient, desc, inArray, gte } from "@ponder/client";
import * as schema from "./ponder.schema";
import { getPonderQueryOptions } from "@ponder/react";

// Get the Ponder server URL from environment variables
const PONDER_URL =
  process.env.NEXT_PUBLIC_PONDER_URL || "http://localhost:42069";

const client = createClient(`${PONDER_URL}/sql`, { schema });

const blocksQueryOptions = getPonderQueryOptions(client, (db) =>
  db.select().from(schema.block).limit(10).orderBy(desc(schema.block.number))
);

const statsQueryOptions = getPonderQueryOptions(client, (db) =>
  db
    .select()
    .from(schema.tenBlockStat)
    .limit(1)
    .orderBy(desc(schema.tenBlockStat.headNumber))
);

const transactionsQueryOptions = (blockNumbers: bigint[]) =>
  getPonderQueryOptions(client, (db) =>
    db
      .select()
      .from(schema.transaction)
      .where(
        blockNumbers.length > 0
          ? inArray(schema.transaction.blockNumber, blockNumbers)
          : gte(schema.transaction.blockNumber, BigInt(0))
      )
      .orderBy(desc(schema.transaction.blockNumber), desc(schema.transaction.transactionIndex))
      .limit(50)
  );

export { client, schema, blocksQueryOptions, statsQueryOptions, transactionsQueryOptions };
