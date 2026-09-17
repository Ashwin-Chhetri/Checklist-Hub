"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, type Persister } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState } from "react";

// No-op persister for the server render — sessionStorage doesn't exist during
// SSR. Both providers only ever wrap children in context (neither renders any
// DOM of its own), so swapping this stub out for the real persister once the
// client mounts causes no hydration mismatch.
const NOOP_PERSISTER: Persister = {
  persistClient: async () => {},
  restoreClient: async () => undefined,
  removeClient: async () => {},
};

// Region-explorer queries (boundary + protected areas + water bodies + region
// stats — see regionQueries.ts) all key their queryKey[0] as "region" and set
// staleTime: Infinity themselves, since a fixed region's data never goes
// stale. Everything else (species/table data, etc.) keeps the default below
// and is never persisted — only "region" queries are worth surviving a page
// refresh, and persisting the rest would just burn sessionStorage's small
// per-origin quota on data that's cheap to refetch anyway.
const PERSIST_QUERY_KEY_PREFIX = "region";
// Overpass results (protected areas / water bodies) can carry many complex
// relation-assembled polygons for a large district — skip persisting any
// single query's data past this size so one huge region can't blow through
// sessionStorage's ~5-10MB per-origin quota and silently break persistence
// for every other query.
const MAX_PERSISTED_QUERY_BYTES = 1.5 * 1024 * 1024;

function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { data: unknown } }): boolean {
  if (query.queryKey[0] !== PERSIST_QUERY_KEY_PREFIX) return false;
  if (query.state.data == null) return false;
  try {
    return JSON.stringify(query.state.data).length <= MAX_PERSISTED_QUERY_BYTES;
  } catch {
    return false;
  }
}

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
          },
        },
      }),
  );

  // The persister needs a real Storage object, which doesn't exist during
  // SSR — this file is "use client" but Next.js still executes the first
  // render on the server, so window/sessionStorage must be guarded.
  const [persister] = useState<Persister>(() =>
    typeof window === "undefined" ? NOOP_PERSISTER : createSyncStoragePersister({ storage: window.sessionStorage, key: "chub-region-cache" }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
