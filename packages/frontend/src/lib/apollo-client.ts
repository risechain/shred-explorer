import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';

const PONDER_URL = process.env.NEXT_PUBLIC_PONDER_URL || 'http://localhost:42069';
const GRAPHQL_URL = `${PONDER_URL}/graphql`;

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
            merge() {
              // For real-time data with limits, always replace with incoming data
              // This ensures we get the latest N blocks, not accumulated results
              return arguments[1]; // incoming
            },
          },
          transactions: {
            keyArgs: ['where', 'orderBy', 'orderDirection', 'limit'],
            merge() {
              // For real-time data with limits, always replace with incoming data
              // This ensures we get the latest N transactions, not accumulated results
              return arguments[1]; // incoming
            },
          },
          tenBlockStats: {
            keyArgs: ['where', 'orderBy', 'orderDirection', 'limit'],
            merge() {
              // Always replace stats data with the latest
              return arguments[1]; // incoming
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