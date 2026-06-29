-- Add merge-tracking columns to the species table.
--
-- is_active              BOOLEAN  – true for all normal rows; false when a row has been
--                                   merged into another, ignored, or otherwise superseded.
--                                   Rows are NEVER deleted — this preserves evidence,
--                                   review history, comments, and enables undo.
--
-- merged_into_species_id UUID FK  – when is_active = false because a row was merged,
--                                   points to the target (accepted) species row.
--                                   NULL for rows that are inactive for other reasons
--                                   (ignored, rejected without a merge target, etc.).
--
-- Workbench default views filter WHERE is_active = true.
-- A new "Merged / Hidden" audit view exposes WHERE is_active = false.

alter table species
  add column is_active              boolean not null default true,
  add column merged_into_species_id uuid references species(id) on delete set null;

create index species_is_active_idx   on species(checklist_id, is_active);
create index species_merged_into_idx on species(merged_into_species_id);
