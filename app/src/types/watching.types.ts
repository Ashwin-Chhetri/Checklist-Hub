import type { TaxonomyClassification } from "@/types/species.types";
import type { SourceKey } from "@/modules/evidence/discovery/types";

export type WatchFrequency = "weekly" | "monthly";
export type WatcherRunStatus = "running" | "completed" | "failed";
export type WatcherCandidateStatus = "pending" | "added" | "dismissed";

export interface Watcher {
  id: string;
  checklist_id: string;
  frequency: WatchFrequency;
  is_active: boolean;
  started_at: string;
  next_run_at: string;
  last_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WatcherSourceSummaryEntry {
  source: SourceKey;
  label: string;
  status: string;
  speciesCount: number;
  totalOccurrences: number;
  occurrenceLabel: string;
  message?: string;
}

export interface WatcherRun {
  id: string;
  watcher_id: string;
  checklist_id: string;
  status: WatcherRunStatus;
  started_at: string;
  completed_at: string | null;
  new_species_count: number;
  updated_species_count: number;
  source_summary: WatcherSourceSummaryEntry[];
  error_message: string | null;
  created_at: string;
}

export interface WatcherCandidateSpecies {
  id: string;
  watcher_run_id: string;
  checklist_id: string;
  scientific_name: string;
  common_name: string | null;
  gbif_taxon_key: number | null;
  family: string | null;
  classification: TaxonomyClassification;
  sources: SourceKey[];
  occurrence_counts: Partial<Record<SourceKey, number>>;
  total_occurrences: number;
  status: WatcherCandidateStatus;
  created_at: string;
}

export interface WatcherObservationUpdate {
  id: string;
  watcher_run_id: string;
  species_id: string;
  previous_counts: Partial<Record<SourceKey, number>>;
  new_counts: Partial<Record<SourceKey, number>>;
  /** Total occurrence count the workbench currently shows for this species (before this run). */
  previous_total: number;
  /** Total occurrence count this run found — what the workbench's "Occurrence" column becomes once applied. */
  new_total: number;
  delta: number;
  applied: boolean;
  created_at: string;
  species?: { id: string; scientific_name: string; common_name: string | null };
}

export interface WatcherRunDetail {
  run: WatcherRun;
  candidates: WatcherCandidateSpecies[];
  observationUpdates: WatcherObservationUpdate[];
}
