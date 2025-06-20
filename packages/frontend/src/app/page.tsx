import Home from "@/components/Home";
import { blocksQueryOptions, statsQueryOptions } from "@/lib/ponder";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";

export default async function App() {
  const queryClient = new QueryClient();
  await Promise.all([
    queryClient.prefetchQuery(blocksQueryOptions),
    queryClient.prefetchQuery(statsQueryOptions),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Home />
    </HydrationBoundary>
  );
}
