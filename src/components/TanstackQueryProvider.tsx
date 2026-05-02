"use client";

// TanstackQueryProvider — wraps the app in a single QueryClient.
//
// Defaults follow plan 04 §A.4:
//   - staleTime 30s for status queries (we get realtime via SSE/Butterbase
//     anyway; stale-while-revalidate pattern)
//   - retries disabled for 4xx (TanStack Query default would retry up to 3x;
//     we only retry 5xx + network errors)
//   - refetchOnWindowFocus off — judges don't need a refetch when alt-tabbing
//     to slides
//
// One client lifetime per browser tab; the provider is mounted at the root
// layout level so server components below it can still pre-fetch via Next's
// built-in fetch cache.

import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // 30s — see plan 04 §A.4
      gcTime: 5 * 60_000,           // 5m garbage-collection
      refetchOnWindowFocus: false,
      retry: (failureCount: number, error: unknown) => {
        // Don't retry on 4xx client errors. Retry up to 2x on 5xx + network.
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? Number((error as { status?: number }).status)
            : 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
    },
    mutations: {
      // Mutations should never silently retry — they have side effects.
      retry: false,
    },
  },
};

export function TanstackQueryProvider({ children }: { children: ReactNode }) {
  // Lazy-init: one QueryClient per browser tab; survives Fast Refresh in dev.
  const [client] = useState(() => new QueryClient(queryClientConfig));

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
