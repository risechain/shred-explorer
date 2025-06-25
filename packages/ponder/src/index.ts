import { ponder } from "ponder:registry";
import { block, transaction, tenBlockStat } from "ponder:schema";

ponder.on("BlockUpdate:block", async ({ context, event }) => {
  const startTime = Date.now();
  
  try {
    // Fetch block data and previous stats in parallel
    const [fullBlock, previousTenBlockStats] = await Promise.all([
      context.client.getBlock({
        blockHash: event.block.hash,
        includeTransactions: true,
      }),
      context.db.find(tenBlockStat, {
        headNumber: event.block.number - 1n,
      })
    ]);

    const blockFetchTime = Date.now() - startTime;
    console.log(`Block ${event.block.number}: Fetched block data in ${blockFetchTime}ms`);

    // Insert/update block record
    await context.db
      .insert(block)
      .values({
        ...event.block,
        transactionCount: fullBlock.transactions.length,
      })
      .onConflictDoUpdate({
        baseFeePerGas: event.block.baseFeePerGas,
        difficulty: event.block.difficulty,
        extraData: event.block.extraData,
        gasLimit: event.block.gasLimit,
        gasUsed: event.block.gasUsed,
        hash: event.block.hash,
        miner: event.block.miner,
        parentHash: event.block.parentHash,
        receiptsRoot: event.block.receiptsRoot,
        size: event.block.size,
        stateRoot: event.block.stateRoot,
        timestamp: event.block.timestamp,
        totalDifficulty: event.block.totalDifficulty,
        transactionsRoot: event.block.transactionsRoot,
        transactionCount: fullBlock.transactions.length,
      });

    const blockInsertTime = Date.now() - startTime;
    console.log(`Block ${event.block.number}: Inserted block in ${blockInsertTime - blockFetchTime}ms`);

    // Batch process transactions - key optimization
    if (fullBlock.transactions.length > 0) {
      const txStartTime = Date.now();
      
      // Process transactions in batches to avoid overwhelming the database
      const BATCH_SIZE = 100;
      const transactions = fullBlock.transactions;
      
      for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        const batch = transactions.slice(i, i + BATCH_SIZE);
        
        // Process batch transactions sequentially but quickly
        const batchPromises = batch.map(async (tx) => {
          return context.db
            .insert(transaction)
            .values({
              hash: tx.hash,
              blockNumber: event.block.number,
              blockHash: event.block.hash,
              transactionIndex: Number(tx.transactionIndex || 0),
              from: tx.from,
              to: tx.to,
              value: tx.value.toString(),
              gasLimit: tx.gas,
              gasUsed: undefined,
              gasPrice: tx.gasPrice,
              maxFeePerGas: tx.maxFeePerGas,
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
              nonce: BigInt(tx.nonce || 0),
              input: tx.input,
              type: tx.type,
            })
            .onConflictDoUpdate({
              blockNumber: event.block.number,
              blockHash: event.block.hash,
              transactionIndex: Number(tx.transactionIndex || 0),
              from: tx.from,
              to: tx.to,
              value: tx.value.toString(),
              gasLimit: tx.gas,
              gasPrice: tx.gasPrice,
              maxFeePerGas: tx.maxFeePerGas,
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
              nonce: BigInt(tx.nonce || 0),
              input: tx.input,
              type: tx.type,
            });
        });

        // Wait for current batch to complete before starting next
        await Promise.all(batchPromises);
        
        console.log(`Block ${event.block.number}: Processed batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(transactions.length/BATCH_SIZE)} (${batch.length} txs)`);
      }

      const txInsertTime = Date.now() - txStartTime;
      console.log(`Block ${event.block.number}: Inserted ${fullBlock.transactions.length} transactions in ${txInsertTime}ms`);
    }

    // Optimized tail block lookup
    let tailBlock = null;
    let tail = 10n;

    // Start from expected position and work backwards
    for (let i = 10n; i > 0n; i--) {
      const candidateBlock = await context.db.find(block, {
        number: event.block.number - i,
      });
      
      if (candidateBlock) {
        tailBlock = candidateBlock;
        tail = i;
        break;
      }
    }

    if (!tailBlock) {
      console.log(`Block ${event.block.number}: No tail block found, skipping stats`);
      const totalTime = Date.now() - startTime;
      console.log(`Block ${event.block.number}: Completed (no stats) in ${totalTime}ms`);
      return;
    }

    // Calculate and insert stats
    if (!previousTenBlockStats) {
      // First stats entry
      await context.db.insert(tenBlockStat).values({
        headNumber: event.block.number,
        headTimestamp: event.block.timestamp,
        totalGas: event.block.gasUsed + tailBlock.gasUsed,
        totalTimeSeconds: Number(event.block.timestamp - tailBlock.timestamp),
        totalTransactions: fullBlock.transactions.length + tailBlock.transactionCount,
      });
    } else {
      // Subsequent stats with sliding window
      const afterTailBlock = await context.db.find(block, {
        number: tailBlock.number + 1n,
      });

      if (!afterTailBlock) {
        throw new Error(`Missing block record at ${tailBlock.number + 1n}`);
      }

      const isAccumulating = tail < 10n;

      await context.db.insert(tenBlockStat).values({
        headNumber: event.block.number,
        headTimestamp: event.block.timestamp,
        totalGas: isAccumulating
          ? previousTenBlockStats.totalGas + event.block.gasUsed
          : previousTenBlockStats.totalGas - tailBlock.gasUsed + event.block.gasUsed,
        totalTimeSeconds: isAccumulating
          ? Number(event.block.timestamp - tailBlock.timestamp)
          : previousTenBlockStats.totalTimeSeconds -
            Number(afterTailBlock.timestamp - tailBlock.timestamp) +
            Number(event.block.timestamp - previousTenBlockStats.headTimestamp),
        totalTransactions: isAccumulating
          ? previousTenBlockStats.totalTransactions + fullBlock.transactions.length
          : previousTenBlockStats.totalTransactions -
            tailBlock.transactionCount +
            fullBlock.transactions.length,
      });
    }

    const totalTime = Date.now() - startTime;
    const rate = fullBlock.transactions.length / (totalTime / 1000);
    console.log(`Block ${event.block.number}: ✅ Completed in ${totalTime}ms (${fullBlock.transactions.length} txs, ${rate.toFixed(1)} tx/s)`);
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`Block ${event.block.number}: ❌ Failed after ${totalTime}ms:`, error);
    throw error;
  }
});