"use client";

import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { client } from "../lib/ponder";
import { ApolloProvider } from "../providers/ApolloProvider";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApolloProvider>
      <QueryClientProvider client={queryClient}>
        <PonderProvider client={client}>
          {children}
        </PonderProvider>
      </QueryClientProvider>
    </ApolloProvider>
  );
}
