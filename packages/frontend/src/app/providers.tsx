"use client";

import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { client } from "../lib/ponder";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PonderProvider>
  );
}
