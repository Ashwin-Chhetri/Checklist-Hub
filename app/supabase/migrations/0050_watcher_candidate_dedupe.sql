-- A watcher run that's interrupted after some candidate inserts but before
-- `watchers.next_run_at` is advanced (function timeout, an overlapping
-- manual run-now, a burst of due watchers all firing at the cron's 3am
-- tick) gets reprocessed by the next tick with nothing stopping it from
-- inserting the same candidate species again. Enforce uniqueness at the DB
-- level as the backstop (the app-level fix in runWatcherEtl.server.ts checks
-- existing pending candidates before inserting, but a constraint makes the
-- guarantee real instead of best-effort).
--
-- Only applies to still-`pending` candidates — once a candidate is
-- resolved (accepted/dismissed), a later run is allowed to surface the same
-- taxon again as a fresh pending row if it's still not in the checklist.
create unique index watcher_candidate_species_pending_taxon_key_idx
  on watcher_candidate_species (checklist_id, gbif_taxon_key)
  where status = 'pending' and gbif_taxon_key is not null;

create unique index watcher_candidate_species_pending_name_idx
  on watcher_candidate_species (checklist_id, lower(scientific_name))
  where status = 'pending' and gbif_taxon_key is null;

-- Same overlapping-run problem at the run level: only one `watcher_runs` row
-- per watcher may be `running` at a time. The app-level check in
-- runWatcherEtl.server.ts (select-then-insert) has a race window between the
-- check and the insert; this constraint closes it for real.
create unique index watcher_runs_one_running_idx
  on watcher_runs (watcher_id)
  where status = 'running';
