import { createConfig } from "ponder";
import { riseTestnet } from "viem/chains";

export default createConfig({
  chains: {
    riseTestnet: {
      id: riseTestnet.id,
      rpc: riseTestnet.rpcUrls.default.http[0],
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
  // database: { 
  //   kind: "postgres", 
  //   connectionString: process.env.DATABASE_URL || "postgresql://username:password@localhost:5432/blocks", 
  // }, 
});
