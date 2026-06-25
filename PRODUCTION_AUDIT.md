# Checklist Hub — Production-Readiness Audit

Date: 2026-06-25. Scope: Auth/RLS/RPCs, Checklist editing & realtime
collaboration, Taxonomy & data pipeline, Publication/IPT & watcher cron.
Method: static code review of `app/src` and `app/supabase/migrations`
(0001–0048), `npm run lint` / `npx tsc --noEmit` / `npm run build` executed
against the real repo, plus direct filesystem inspection of `app/data`.
**No browser automation was available in this session**, so the two-tab
realtime-collaboration race tests below are written up as exact manual steps
for you to run — they are not yet executed.

## Top 5 — fix before you push to prod

1. **(P0) The local SQLite reference data (2.78GB) cannot ship to Vercel as configured.** Taxonomy resolution will silently return empty results in production.
2. **(P1) Every client-callable write RPC (≈20 functions) is missing `set search_path = public`.** Inconsistent with your own trigger functions, which all have it.
3. **(P2) `resolve-batch` vernacular-name lookup is N+1.** Confirmed in code; quantify with a live timing test.
4. **(P2) Comment/review Realtime events are broadcast to every open checklist tab on the server, filtered only client-side.** Documented as a known tradeoff in code, but a real scalability ceiling.
5. **(P1) Watcher cron has no de-dupe guard on `watcher_candidate_species` inserts and advances `next_run_at` only at the very end of the run.** A crash mid-run or an overlapping `run-now` can double-insert candidates.

---

## Area A — Auth & permissions / RLS / security-definer RPCs

**RLS coverage: verified clean.** All 31 tables created across the 48
migrations have a matching `enable row level security` statement — no gaps
found (cross-checked `create table` vs `alter table ... enable row level
security` greps across every migration).

**Service-role usage: verified clean.** `createServiceClient`/service-role
key is used in exactly 3 files, all in the watcher cron path
(`runWatcherEtl.server.ts`, `api/cron/watcher-tick/route.ts`,
`lib/supabase/serviceClient.ts`). No API route bypasses RLS outside the cron
job.

**Storage policies: verified clean.** The `(storage.foldername(name))[1]::uuid`
cast pattern (migrations 0001, 0038) is used consistently for
evidence/publication-export buckets; no other path-parsing pattern competes
with it.

### Finding A1 — P1 — Security-definer RPCs missing `search_path` guard
**Where:** every client-callable RPC with `p_*` parameters, e.g.
`app/supabase/migrations/0006_create_checklist_with_species_security_definer.sql:23`,
`0010_fix_rpc_collaborators.sql:13`, `0014_add_species_to_checklist.sql:21`,
`0015_checklist_region_pin.sql:15`, `0016_resolve_actions_rpc.sql:28,94,179,280,372`,
`0018_invite_collaborator_rpc.sql:27,154`, `0019_fix_invite_email_case.sql:70,142`,
`0020_fix_synonym_vote_autoresolve.sql:17`, `0021_update_collaborator_role_rpc.sql:13`,
`0023_separate_review_synonym_votes_and_synonym_outcome.sql:45,130`,
`0024_full_access_collaborators.sql:41,114,262`, `0025_review_status_consensus.sql:56`,
`0027_fix_review_decision_cast.sql:16`.

**What's wrong:** these are all declared `language plpgsql ... security definer`
with **no `set search_path = public`**. Contrast with every *trigger* function
in the same migrations (`handle_new_user`, `notify_*`, `log_*`,
`sync_taxonomy_status_from_conflicts`, `role_rank`/`auth_has_role`/`auth_is_member`
in 0001) which all correctly set it. The split looks systematic: triggers got
the guard, RPCs called directly from the app server didn't.

**Why it matters:** a `security definer` function executes with the
function owner's privileges and, without a pinned `search_path`, resolves
unqualified object references using the *caller's* search_path. If any role
this runs under can ever have a writable schema earlier in its search_path
than where the real objects live, a malicious search_path could redirect the
function to attacker-controlled objects — the standard Postgres
SECURITY DEFINER privilege-escalation vector (CVE-class issue, not unique to
this app). Supabase's default `anon`/`authenticated` roles don't have
`CREATE` on `public`, which limits exploitability today, but this is a
correctness gap that should be closed regardless — it's one line per
function and you've already proven you know the fix (it's right there in
your trigger functions).

**Suggested fix:** add a new migration that runs
`alter function <name>(<args>) set search_path = public;` for each of the ~20
functions listed above (or `create or replace function ... security definer
set search_path = public ...` if you'd rather reissue the bodies).

**Confidence:** verified by reading every migration's function signature.

### Finding A2 — P3 — Collaborator demotion doesn't proactively cut Realtime presence/broadcast
**Where:** `app/src/app/api/checklists/[id]/collaborators/[userId]/route.ts`
(role update/removal) vs. `app/src/modules/collaboration/services/realtimeChannel.ts`.

**What's wrong:** RLS is re-evaluated per Postgres query, so table reads/writes
correctly reflect a demoted role on the next request. But the Supabase
Realtime *presence* and *broadcast* features for an already-open channel
aren't gated by RLS at all — they're authorized once at `channel.subscribe()`
time via Realtime's own authorization (topic-level), not re-checked per
message after that point.

**Why it matters:** a user removed from a checklist while they have it open
in a browser tab could continue to see live presence/broadcast traffic
(who's online, live cell-edit previews) for that checklist until they close
the tab or the token naturally expires/refreshes — they wouldn't be able to
read/write table data, but presence/broadcast isn't blocked.

**Suggested fix:** low priority for V1, since the actual data (species,
comments, reviews) stays correctly RLS-gated. If you want to close this, the
fix is forcing a Realtime re-auth on every `checklist_collaborators` change
(your existing `onCollaboratorChange` handler already invalidates collaborator
queries — extend it to also `channel.unsubscribe()`+resubscribe when the
current user's own row is the one that changed).

**Confidence:** code-read; not live-tested (would need a removed-user session
kept open during a removal, no browser automation available this session).

---

## Area B — Taxonomy & data pipeline

### Finding B1 — P2 — N+1 SQLite query in vernacular-name lookup
**Where:** `app/src/app/api/taxonomy/resolve-batch/route.ts:58-66`.

```ts
if (includeVernacularNames) {
  for (const row of rows) {
    const taxonId = row.taxon_id as number;
    row.vernacular_names = getVernacularNames(taxonId); // one query per row
  }
}
```

**What's wrong:** this issues one `better-sqlite3` query per resolved taxon,
instead of one batched `IN (...)` query — the exact pattern already used two
lines above it for the main `gbif_taxa` lookup.

**Why it matters:** for a checklist with, say, 200–500 species and
`includeVernacularNames: true`, this is 200–500 synchronous SQLite round-trips
per request on a code path that's almost certainly hit during the bulk
taxonomic-resolution step of the V1 workflow. Not measured live this session
(would need the dev server running) — recommend timing it yourself: hit
`resolve-batch` with a real-sized `speciesKeys` array, with and without
`includeVernacularNames`, and compare response time.

**Suggested fix:** batch it the same way the main lookup does —
`SELECT * FROM vernacular_names WHERE taxon_id IN (...)` once, then group the
results by `taxon_id` in JS before attaching to each row.

**Confidence:** verified by reading the code; performance impact not yet
measured live.

### Finding B2 — P0 — Local SQLite reference data is not deployable as configured
**Where:** `app/data/` (confirmed via direct filesystem listing),
`app/vercel.json`, `app/package.json` scripts, `app/.gitignore:` `/data/`.

**What's wrong, confirmed directly:**
- `app/data/gbif-backbone.sqlite` is **2.58 GB**; `app/data/gadm.sqlite` is
  **193 MB**. Combined ~2.78 GB.
- The entire `data/` directory is gitignored — these files are never
  committed.
- `vercel.json` has no `buildCommand` override; the only script Vercel will
  run is `next build` (per `package.json`'s `build` script). Neither
  `build:backbone` nor `build:gadm` is wired into the deploy process anywhere.
- `AGENTS.md` itself already flags this exact risk: *"make sure the built
  `.sqlite` file(s) are present on the server's persistent disk."* Right now,
  nothing makes that true for a fresh Vercel deployment.

**Why it matters, concretely:**
1. On a clean Vercel deploy, `app/data/gbif-backbone.sqlite` won't exist.
   `getDb()` in `resolve-batch/route.ts` (and the equivalent in every other
   SQLite-backed route) catches the `fileMustExist` error and returns
   `null` → the route returns `{ rows: [] }`. **Taxonomy resolution silently
   does nothing — no error surfaces to the user or to your logs.** This is a
   functional outage disguised as "no results," which is worse than a crash.
2. Even if you tried to commit these files or generate them at build time,
   Vercel serverless functions are size- and storage-constrained in ways that
   don't fit a 2.78 GB local file: standard deployment/function bundle limits
   are far below this (low hundreds of MB), and a function's writable
   `/tmp` is ephemeral and capped well under 2.78 GB. **This architecture
   cannot run as-is on Vercel's standard serverless runtime regardless of how
   the build step is wired.**

**Suggested fix — pick one before going to production:**
- Move the GBIF backbone / GADM data to a deployment target with real
  persistent disk (e.g. a long-running container/VM, Fly.io volumes, Render
  persistent disks) instead of Vercel serverless functions, and keep this app
  there or split the SQLite-backed routes into a separate always-on service.
- Or migrate the heavy reference lookups into a managed service designed for
  this (e.g. read-replica Postgres elsewhere, a hosted key-value/lookup
  service, or even Vercel's own Edge Config / Blob for smaller derived
  indexes) — a real architecture change, not a quick fix.
- At minimum, **right now**: make `getDb()` log loudly (not swallow the
  exception) when the file is missing, so a misconfigured deploy fails
  loudly instead of silently returning empty taxonomy data.

**Confidence:** verified live — file sizes measured directly on disk,
`vercel.json`/`package.json`/`.gitignore` read directly. This is the single
highest-severity, most certain finding in this audit.

### Finding B3 — informational — conflict/synonym consensus migration churn
**Where:** `taxonomy_conflicts`/`taxonomy_votes`/`taxonomy_synonyms` logic
across migrations 0009, 0011, 0013, 0020, 0023.

Five migrations have iteratively patched this consensus logic. The current
state (0023 onward) reads as internally consistent, but this is exactly the
kind of logic that benefits from the live two-reviewer race test described
in Area C below rather than another static read — flagging it here so it
isn't skipped.

---

## Area C — Checklist editing & realtime collaboration

### Finding C1 — P2 — Comment/review Realtime events aren't filtered server-side
**Where:** `app/src/modules/collaboration/services/realtimeChannel.ts:51-60`
vs. the client-side filter in
`app/src/modules/collaboration/hooks/useChecklistRealtimeChannel.ts:52-66`.

**What's wrong:** the `species_comments` and `species_reviews`
`postgres_changes` subscriptions have no `filter:` (unlike `species`,
`activity_log`, `checklist_collaborators`, `checklist_invites`, which all
filter by `checklist_id=eq.${checklistId}`). The code comment explains why:
*"comment/review changes are scoped to this checklist's species via
speciesIds since those two tables have no checklist_id column to filter on
server-side."* The client then correctly checks
`speciesIdsRef.current.has(speciesId)` before invalidating any cache — **so
this is not a data-correctness or cross-checklist-leak bug**, I want to
correct the more alarming framing this could otherwise get. It is a real
scalability/bandwidth issue: every open checklist tab, for every connected
user across the entire deployment, receives a Postgres Realtime message for
every comment and every review on *any* checklist, and discards almost all
of them client-side.

**Why it matters:** fine at current scale; becomes a real bottleneck as
concurrent users and total comment/review volume grow, since Realtime
message fan-out cost scales with total system-wide write volume × number of
open channels, not with relevant data volume.

**Suggested fix:** add a `checklist_id` column to `species_comments` and
`species_reviews` (denormalized from `species.checklist_id`, kept in sync via
a trigger or just set at insert time) so these subscriptions can filter
server-side like the others. This is a schema change — size it as a
follow-up, not a pre-launch blocker, unless you expect high concurrent load
immediately.

**Confidence:** verified by reading both the subscription and the consuming
hook.

### Finding C2 — verified clean — presence store doesn't leak across checklists
`usePresenceStore`'s `clear()` is called in the `useEffect` cleanup of
`useChecklistRealtimeChannel.ts:93`, which fires on unmount and on
`checklistId`/`currentUser` change — navigating between checklists correctly
clears stale presence. No fix needed.

### Finding C3 — needs live verification — review/conflict-vote race conditions
**Where:** `review-vote`, `conflict-vote`, `resolve-conflict`,
`resolve-taxonomy` RPCs (migrations 0016, 0020, 0023, 0025, 0027).

The repeated "fix_*" migrations (0010, 0019, 0020, 0027) on this exact logic
area are a strong signal it's been fragile before. I read the current RPC
bodies and they consistently use single-statement `insert ... on conflict do
update` / `update ... where` patterns inside one `security definer` function
call (atomic from the API route's perspective), which is the right shape to
avoid read-then-write races. I could not find an obvious remaining race in
the current SQL, but this is exactly the category of bug that only shows up
under real concurrent load, not static reading.

**Recommended manual test (no browser automation was available to me this
session):**
1. Open the same checklist as two different reviewer accounts in two browser
   profiles.
2. On the same species, have both submit a review-vote within ~1 second of
   each other (one accept, one reject, or both accept).
3. Check `species_reviews` and the species' resulting `review_status` in
   Supabase Studio afterward — confirm exactly one consistent outcome, no
   duplicate vote rows for the same reviewer, and no review_status that
   doesn't match what the vote rows actually say.
4. Repeat for `conflict-vote`/`resolve-taxonomy` on a synonym conflict.

**Confidence:** code-read only; live race test not performed.

### Finding C4 — verified clean — "Never Auto-Accept Species" invariant holds
Grepped all writes of `review_status` to `'accepted'` across `src/`. The only
write site is the reviewer-driven RPC path; nothing in `runWatcherEtl.server.ts`,
`mergeSpeciesData.server.ts`, or `enrichSpeciesTaxonomy.server.ts` sets
`review_status` at all — these modules only touch taxonomy/observation data,
never the review decision. The architectural principle is actually enforced
in code, not just documented.

---

## Area D — Publication/IPT & watcher cron

### Finding D1 — P1 — Watcher cron has no de-dupe guard and a late `next_run_at` advance
**Where:** `app/src/modules/watching/runWatcherEtl.server.ts:282-293` (insert),
`:339-342` (`next_run_at` advance, at the very end of the function),
`app/supabase/migrations/0046_watching.sql:63-106` (`watcher_candidate_species`
schema — only `watcher_candidate_species_run_idx` and a partial pending-status
index exist; **no unique constraint** on e.g. `(checklist_id,
gbif_taxon_key)`).

**What's wrong:** `watcher_candidate_species` rows are inserted with a blind
`.insert()`. `next_run_at`/`last_run_at` on the `watchers` row are only
updated after every candidate/observation-update insert has already
succeeded, at the bottom of the function. The cron route itself
(`api/cron/watcher-tick/route.ts:30-32`) fires every due watcher concurrently
via `Promise.allSettled` with no concurrency cap, and there's no in-progress
flag on a watcher to prevent a manual `run-now` call from overlapping a
concurrent cron tick for the same watcher.

**Why it matters:** if a run is interrupted after some candidate inserts
but before the `next_run_at` update (function timeout, one external
GBIF/eBird call hanging while N other due watchers also fire at 3am, an
overlapping manual `run-now`), the watcher's `next_run_at` stays in the past.
The next tick (or the overlapping manual run) reprocesses the same source
data and, because there's no unique constraint, can insert **duplicate
candidate-species rows** for the same scientific name on the same checklist,
which a reviewer would then see twice in the workbench review queue.

**Suggested fix:**
- Add a unique constraint/partial unique index on
  `watcher_candidate_species (checklist_id, gbif_taxon_key) where status =
  'pending'` (or `scientific_name` if `gbif_taxon_key` can be null) and switch
  the insert to `upsert`/`on conflict do nothing`.
- Mark the watcher `last_run_at`/status as "running" at the *start* of
  `runWatcherEtl`, and have both `run-now` and the cron tick skip a watcher
  that's already "running" (with a stale-lock timeout so a genuinely crashed
  run doesn't permanently block future ticks).
- Add a concurrency cap (e.g. process due watchers in batches of 5–10) so a
  burst of due watchers can't simultaneously hit external API rate limits or
  pile up function execution time.

**Confidence:** verified by reading the ETL function and the migration's
index list; not live-tested (would need an actual double-trigger of the cron
route with real watcher data — recommend curling
`GET /api/cron/watcher-tick` with the correct `Authorization: Bearer
$CRON_SECRET` header twice within a minute against your dev Supabase project
and inspecting `watcher_runs`/`watcher_candidate_species` for duplicates).

### Finding D2 — verified clean — Darwin Core export only includes accepted species
**Where:** `app/src/modules/publication/services/publicationService.ts:29` —
`.eq("review_status", "accepted")` is applied when fetching species for
export, before `darwinCore.ts` ever sees the data. The never-auto-accept
invariant holds at the publication boundary.

### Finding D3 — not yet verified — publication version-number race
**Where:** `app/supabase/migrations/0044_publication_versions_and_edit_log.sql`,
`app/src/modules/publication/services/publicationVersionsService.ts`.

Did not get to fully trace whether version-number assignment uses a DB
sequence/unique constraint vs. an app-computed `max(version)+1` (which would
race under two simultaneous publish actions). Flagging as a follow-up rather
than a confirmed finding — read migration 0044's `insert` path for
`checklist_publication_versions` to confirm before relying on this area under
concurrent publishing.

---

## Appendix

### Baseline tool output
- `npm run lint`: **8 errors, 14 warnings.** Errors are concentrated in
  `app/src/app/onboarding/page.tsx` (×2) and
  `components/checklist-wizard/step2/discovery/SpeciesInventoryPanel.tsx`
  (`react-hooks/set-state-in-effect` — calling `setState` synchronously
  inside a `useEffect`, a real cascading-render risk worth cleaning up before
  launch, not just style), plus `no-explicit-any` in `app/page.tsx` and
  `SiteNavbar.tsx`, and an unescaped apostrophe in `DeepSearchDialog.tsx`.
  None are security- or data-correctness bugs, but the `set-state-in-effect`
  ones are genuine perf/UX smells worth a quick pass.
- `npx tsc --noEmit`: **clean, zero errors.**
- `npm run build`: **succeeds cleanly**, all 31 API routes and pages compile;
  no `better-sqlite3` bundling warnings.

### RLS coverage matrix (table → creating migration → RLS-enabling migration)
| Table | Created in | RLS enabled in |
|---|---|---|
| profiles | 0001 | 0001 |
| checklists | 0001 | 0001 |
| checklist_collaborators | 0001 | 0001 |
| species | 0001 | 0001 |
| species_comments | 0001 | 0001 |
| species_reviews | 0001 | 0001 |
| checklist_imports | 0001 | 0001 |
| import_issues | 0001 | 0001 |
| notifications | 0001 | 0001 |
| activity_log | 0001 | 0001 |
| external_api_cache | 0001 | 0001 |
| evidence_sources | 0005 | 0005 |
| external_db_records | 0005 | 0005 |
| publications | 0005 | 0005 |
| historical_mentions | 0005 | 0005 |
| taxonomy_conflicts | 0005 | 0005 |
| taxonomy_votes | 0005 | 0005 |
| taxonomy_synonyms | 0005 | 0005 |
| checklist_invites | 0005 | 0005 |
| region_boundaries | 0029 | 0029 |
| checklist_metadata | 0033 | 0033 |
| checklist_contributors | 0033 | 0033 |
| checklist_publication_snapshots | 0034 | 0034 |
| checklist_publication_drafts | 0036 | 0036 |
| checklist_publication_comments | 0037 | 0037 |
| publishing_organizations | 0040 | 0040 |
| checklist_publication_versions | 0044 | 0044 |
| watchers | 0046 | 0046 |
| watcher_subscribers | 0046 | 0046 |
| watcher_runs | 0046 | 0046 |
| watcher_candidate_species | 0046 | 0046 |
| watcher_observation_updates | 0046 | 0046 |

No gaps. Every table is covered in the same migration it was created in.

### What was verified live vs. only by reading code
- **Verified live this session:** `npm run lint`/`tsc`/`build` output; the
  exact sizes and gitignore status of `app/data/*.sqlite`; `vercel.json` and
  `package.json` script wiring (Finding B2).
- **Verified by reading code, high confidence:** RLS coverage matrix,
  service-role usage scope, search_path gap (A1), N+1 in resolve-batch (B1),
  comment/review filter design (C1), never-auto-accept invariant (C4),
  Darwin Core accepted-only export (D2), watcher de-dupe gap (D1).
- **Not yet verified — needs your hands-on testing (no browser automation
  available this session):** review/conflict-vote concurrent race (C3),
  collaborator-demotion presence cutoff (A2), resolve-batch N+1 actual timing
  numbers (B1), cron double-trigger duplicate-row check (D1), publication
  version-number race (D3). Exact manual steps for each are given inline
  above.
