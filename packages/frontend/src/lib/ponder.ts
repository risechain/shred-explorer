import { createClient, desc } from "@ponder/client";
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

export { client, schema, blocksQueryOptions, statsQueryOptions };
