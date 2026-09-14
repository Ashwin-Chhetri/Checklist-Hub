import { createClient } from "@/lib/supabase/client";

// Supabase rotates refresh tokens on use: refreshing invalidates the old
// refresh token cookie and issues a new one. A species import fires several
// append requests concurrently (see BATCH_CONCURRENCY in checklistService),
// each hitting proxy.ts's own `supabase.auth.getUser()` refresh-on-expiry
// check. If the session happens to be stale when a batch of requests goes
// out together, they all read the same (not-yet-rotated) refresh token and
// race to redeem it — only the first succeeds, the rest get a spurious
// "Not authenticated." even though the user's session is fine.
//
// Coalescing every concurrent refresh into a single in-flight call (instead
// of letting each caller trigger its own) avoids re-triggering that same
// race when several batches hit a 401 at the same moment.
let refreshInFlight: Promise<void> | null = null;

export function refreshSessionOnce(): Promise<void> {
  if (!refreshInFlight) {
    const supabase = createClient();
    refreshInFlight = supabase.auth
      .refreshSession()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}
