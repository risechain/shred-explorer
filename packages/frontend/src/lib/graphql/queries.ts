import { gql } from '@apollo/client';

export const GET_LATEST_BLOCKS = gql`
  query GetLatestBlocks($limit: Int!) {
    blocks(orderBy: "number", orderDirection: "desc", limit: $limit) {
      items {
        number
        hash
        parentHash
        timestamp
        transactionCount
        gasUsed
        gasLimit
        baseFeePerGas
        miner
        difficulty
        totalDifficulty
        size
        transactionsRoot
        stateRoot
        receiptsRoot
        extraData
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_LATEST_STATS = gql`
  query GetLatestStats {
    tenBlockStats(orderBy: "headNumber", orderDirection: "desc", limit: 1) {
      items {
        headNumber
        totalTransactions
        totalGas
        totalTimeSeconds
        headTimestamp
      }
    }
  }
`;

export const GET_TRANSACTIONS_BY_BLOCKS = gql`
  query GetTransactionsByBlocks($blockNumbers: [BigInt!]!) {
    transactions(
      where: { blockNumber_in: $blockNumbers }
      orderBy: "blockNumber"
      orderDirection: "desc"
      limit: 50
    ) {
      items {
        hash
        blockNumber
        blockHash
        transactionIndex
        from
        to
        value
        gasLimit
        gasUsed
        gasPrice
        maxFeePerGas
        maxPriorityFeePerGas
        nonce
        input
        type
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_LATEST_TRANSACTIONS = gql`
  query GetLatestTransactions($limit: Int!) {
    transactions(orderBy: "blockNumber", orderDirection: "desc", limit: $limit) {
      items {
        hash
        blockNumber
        blockHash
        transactionIndex
        from
        to
        value
        gasLimit
        gasUsed
        gasPrice
        maxFeePerGas
        maxPriorityFeePerGas
        nonce
        input
        type
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_SYNCHRONIZED_DATA = gql`
  query GetSynchronizedData($blocksLimit: Int!, $transactionsLimit: Int!) {
    blocks(orderBy: "number", orderDirection: "desc", limit: $blocksLimit) {
      items {
        number
        hash
        parentHash
        timestamp
        transactionCount
        gasUsed
        gasLimit
        baseFeePerGas
        miner
        difficulty
        totalDifficulty
        size
        transactionsRoot
        stateRoot
        receiptsRoot
        extraData
        createdAt
        updatedAt
      }
    }
    tenBlockStats(orderBy: "headNumber", orderDirection: "desc", limit: 1) {
      items {
        headNumber
        totalTransactions
        totalGas
        totalTimeSeconds
        headTimestamp
      }
    }
    transactions(orderBy: "blockNumber", orderDirection: "desc", limit: $transactionsLimit) {
      items {
        hash
        blockNumber
        blockHash
        transactionIndex
        from
        to
        value
        gasLimit
        gasUsed
        gasPrice
        maxFeePerGas
        maxPriorityFeePerGas
        nonce
        input
        type
        createdAt
        updatedAt
      }
    }
  }
`;