import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Service-role Supabase client — bypasses RLS entirely. There is no user
 * session to bind cookies to here; this exists only for server-only code
 * with no logged-in actor (the Watcher cron tick). Never import this from
 * client code or from a route that has a real user session — use
 * `src/lib/supabase/server.ts` for those instead.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
