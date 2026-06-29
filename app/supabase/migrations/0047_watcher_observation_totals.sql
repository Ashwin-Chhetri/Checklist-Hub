-- Watcher observation updates need an explicit before/after TOTAL occurrence
-- count (matching the single number shown as "Occurrence" in the workbench
-- table, species.evidence.occurrence_count) — the per-source jsonb breakdown
-- alone doesn't convey "workbench shows 500, sources now report 598".
-- Additive only: does not modify any existing column.

alter table watcher_observation_updates
  add column if not exists previous_total int not null default 0,
  add column if not exists new_total int not null default 0;
