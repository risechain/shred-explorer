import { cache } from "hono/cache";
import type { MiddlewareHandler } from "hono";

// Cache middleware for SQL endpoint
// Cache for 10 seconds for real-time data
export const sqlCache: MiddlewareHandler = cache({
  cacheName: "ponder-sql",
  cacheControl: "max-age=1",
  wait: true,
  keyGenerator: (c) => {
    const url = new URL(c.req.url);
    return `${c.req.method}:${url.pathname}${url.search}`;
  },
});

// Cache middleware for GraphQL endpoint
// Cache for 5 seconds for GraphQL queries
export const graphqlCache: MiddlewareHandler = cache({
  cacheName: "ponder-graphql",
  cacheControl: "max-age=1",
  wait: true,
  keyGenerator: async (c) => {
    const url = new URL(c.req.url);
    // Include the request body in cache key for GraphQL POST requests
    if (c.req.method === "POST") {
      const body = await c.req.text();
      return `${c.req.method}:${url.pathname}:${body}`;
    }
    return `${c.req.method}:${url.pathname}${url.search}`;
  },
});

// Cache middleware for root GraphQL endpoint
export const rootGraphqlCache: MiddlewareHandler = cache({
  cacheName: "ponder-graphql-root",
  cacheControl: "max-age=1",
  wait: true,
  keyGenerator: async (c) => {
    const url = new URL(c.req.url);
    if (c.req.method === "POST") {
      const body = await c.req.text();
      return `${c.req.method}:${url.pathname}:${body}`;
    }
    return `${c.req.method}:${url.pathname}${url.search}`;
  },
});