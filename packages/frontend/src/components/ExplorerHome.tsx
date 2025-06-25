"use client";

import { useMemo } from "react";
import Home from "./Home";
import HomeGraphQL from "./HomeGraphQL";

export default function ExplorerHome() {
  const useGraphQL = useMemo(() => {
    const envVar = process.env.NEXT_PUBLIC_USE_GRAPHQL;
    // Default to GraphQL unless explicitly set to false
    return envVar !== 'false' && envVar !== '0';
  }, []);

  // Use GraphQL version by default, SQL version as fallback
  return useGraphQL ? <HomeGraphQL /> : <Home />;
}