import { createConfig } from "ponder";
import { riseTestnet } from "viem/chains";

export default createConfig({
  chains: {
    riseTestnet: {
      id: riseTestnet.id,
      rpc: process.env.PONDER_RPC_URL_1 || riseTestnet.rpcUrls.default.http[0],
      ws: riseTestnet.rpcUrls.default.webSocket[0],
    },
  },
  blocks: {
    BlockUpdate: {
      chain: "riseTestnet",
      interval: 1,
      startBlock: "latest",
    },
  },
  // Use SQLite for development (no setup required)
  // For production with high throughput, use PostgreSQL:
  // database: { 
  //   kind: "postgres", 
  //   connectionString: process.env.DATABASE_URL,
  //   poolConfig: {
  //     max: 20,
  //     ssl: false,
  //   },
  // },
});
