import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { sqlCache, graphqlCache, rootGraphqlCache } from "./middleware/cache";

const app = new Hono();

// Apply caching middleware
app.use("/sql/*", sqlCache);
app.use("/graphql", graphqlCache);
app.use("/", rootGraphqlCache);

// API routes
app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
