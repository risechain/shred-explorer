import { ponder } from "ponder:registry";
import { block, transaction, tenBlockStat } from "ponder:schema";

ponder.on("BlockUpdate:block", async ({ context, event }) => {

  // gross patch for Block at hash could not be found
  await new Promise(resolve => setTimeout(resolve, 100));

  const fullBlock = await context.client.getBlock({
    blockHash: event.block.hash,
    includeTransactions: true,
  });

  // Insert or update the block record
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

  // Batch insert all transactions in a single database transaction
  if (fullBlock.transactions.length > 0) {
    // Prepare all transaction data
    const transactionValues = fullBlock.transactions.map(tx => ({
      hash: tx.hash,
      blockNumber: event.block.number,
      blockHash: event.block.hash,
      transactionIndex: Number(tx.transactionIndex || 0),
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gasLimit: tx.gas,
      gasUsed: undefined, // Will be set if we have receipt data
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      nonce: BigInt(tx.nonce || 0),
      input: tx.input,
      type: tx.type,
    }));

    // Use database transaction for atomic batch insert

    await context.db
      .insert(transaction)
      .values(transactionValues)
    
    console.log(`Block ${event.block.number}: Batch inserted ${fullBlock.transactions.length} transactions`);
  }

  let tail = 10n;

  const tailBlock = await (async () => {
    while (tail > 0n) {
      const tailBlock_ = await context.db.find(block, {
        number: event.block.number - tail,
      });

      if (tailBlock_) return tailBlock_;

      tail = tail - 1n;
    }
  })();

  if (!tailBlock) return;

  const previousTenBlockStats = await context.db.find(tenBlockStat, {
    headNumber: event.block.number - 1n,
  });

  if (!previousTenBlockStats) {
    await context.db.insert(tenBlockStat).values({
      headNumber: event.block.number,
      headTimestamp: event.block.timestamp,
      totalGas: event.block.gasUsed + tailBlock.gasUsed,
      totalTimeSeconds: Number(event.block.timestamp - tailBlock.timestamp),
      totalTransactions:
        fullBlock.transactions.length + tailBlock.transactionCount,
    });

    return;
  }

  const afterTailBlock = await context.db.find(block, {
    number: tailBlock.number + 1n,
  });

  if (!afterTailBlock) {
    throw new Error("Unexpected missing block record");
  }

  const isAccumulating = tail < 10n;

  await context.db.insert(tenBlockStat).values({
    headNumber: event.block.number,
    totalGas: isAccumulating
      ? previousTenBlockStats.totalGas + event.block.gasUsed
      : previousTenBlockStats.totalGas -
        tailBlock.gasUsed +
        event.block.gasUsed,
    totalTimeSeconds: isAccumulating
      ? Number(event.block.timestamp - tailBlock.timestamp)
      : previousTenBlockStats.totalTimeSeconds -
        Number(afterTailBlock.timestamp - tailBlock.timestamp) +
        Number(event.block.timestamp - previousTenBlockStats.headTimestamp),
    headTimestamp: event.block.timestamp,
    totalTransactions: isAccumulating
      ? previousTenBlockStats.totalTransactions + fullBlock.transactions.length
      : previousTenBlockStats.totalTransactions -
        tailBlock.transactionCount +
        fullBlock.transactions.length,
  });
});
