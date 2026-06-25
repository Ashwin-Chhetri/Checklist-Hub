<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Where logic lives — client / app server / Supabase

There is no separate standalone backend server. Everything lives in this one
Next.js app, split into three layers:

- **Client** — React components (`src/components/**`) and hooks
  (`src/modules/**/hooks/*.ts`). Uses TanStack React Query for server-state
  caching and Zustand only for ephemeral UI/presence state
  (`src/modules/collaboration/stores/presenceStore.ts`). The client talks to
  Supabase directly only for (a) reads RLS already allows and (b) Realtime
  subscriptions (`postgres_changes`/presence/broadcast via
  `src/modules/collaboration/services/realtimeChannel.ts`). Any write that
  needs auth checks beyond RLS, validation, or multi-table consistency goes
  through the app server instead.
- **App server** — Next.js API routes (`src/app/api/**/route.ts`). This is
  the "server side" — server-only code that uses the cookie-bound Supabase
  server client (`src/lib/supabase/server.ts`) and is the only place that
  reads the local SQLite reference data (see below). Routes that used to
  chain several sequential Postgrest calls should instead make one call to a
  `security definer` Postgres RPC function (see `supabase/migrations/0006_*`,
  `0016_*`) so the route stays a thin auth+validate+single-RPC-call wrapper.
- **Supabase** — Postgres (the actual database) + Auth + Realtime + Storage.
  RLS policies are the authorization boundary for direct client reads;
  `security definer` RPC functions are the boundary for writes that need to
  bypass RLS safely with an explicit `auth.uid()` guard. Realtime
  `postgres_changes` pushes DB writes to all connected clients without
  polling — this is what keeps multiple users' views in sync.

The local SQLite layer described below is the one deliberate exception: it
bypasses Supabase entirely and is read-only from app-server routes via
`better-sqlite3`.

# Heavy/reference data tables — do not put these in Supabase

Supabase (this project's Postgres) is for application data only: user
accounts, checklists, profiles, etc. It is **not** for large reference,
import, or cache tables — the free-tier storage quota gets exhausted quickly
(this happened with a ~5.5M-row GBIF backbone mirror).

Examples of "heavy" tables that belong on the **server filesystem** instead,
as local SQLite files built by `scripts/*.mjs` and served through Next.js API
routes (e.g. `src/app/api/taxonomy/resolve-batch/route.ts`):

- GBIF Backbone Taxonomy
- Catalogue of Life
- Taxonomic snapshots
- Occurrence caches
- Any other large bulk-import table

Pattern to follow:
1. A `scripts/build-*.mjs` script downloads/processes the source data into
   `app/data/*.sqlite` (gitignored — rebuilt per environment via
   `npm run build:*`).
2. A server-only API route (`src/app/api/.../route.ts`) opens the SQLite file
   with `better-sqlite3` (readonly) and answers lookups.
3. Client code (`src/modules/**/services/*.ts`) calls that API route via
   `fetch`, never a Supabase client, for this kind of data.

On deployment, make sure the built `.sqlite` file(s) are present on the
server's persistent disk (run the relevant `build:*` script as part of the
deploy/build step, or ship the file alongside the build output).
