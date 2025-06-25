import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:42069/graphql';

const httpLink = createHttpLink({
  uri: GRAPHQL_URL,
});

export const apolloClient = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          blocks: {
            keyArgs: ['where', 'orderBy', 'orderDirection', 'limit'],
            merge(existing, incoming, { args }) {
              // For real-time data with limits, always replace with incoming data
              // This ensures we get the latest N blocks, not accumulated results
              return incoming;
            },
          },
          transactions: {
            keyArgs: ['where', 'orderBy', 'orderDirection', 'limit'],
            merge(existing, incoming, { args }) {
              // For real-time data with limits, always replace with incoming data
              // This ensures we get the latest N transactions, not accumulated results
              return incoming;
            },
          },
          tenBlockStats: {
            keyArgs: ['where', 'orderBy', 'orderDirection', 'limit'],
            merge(existing, incoming) {
              // Always replace stats data with the latest
              return incoming;
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
});