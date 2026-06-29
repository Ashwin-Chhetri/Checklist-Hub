-- Add notes column to taxonomy_conflicts.
-- Previously notes were stored only in the JSONB field species.taxonomy.authority_conflicts[].notes
-- and were lost from the normalized table. This migration adds the column and the RPC
-- already inserts it (handled in migration 0011 which replaced the RPC).

alter table taxonomy_conflicts
  add column if not exists notes text;
