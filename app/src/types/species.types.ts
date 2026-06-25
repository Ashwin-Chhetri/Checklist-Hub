export type EvidenceQuality = "high" | "medium" | "low" | "insufficient";
export type TaxonomyStatus = "accepted" | "synonym" | "authority_conflict" | "unresolved";
export type ReviewStatus = "not_reviewed" | "under_review" | "reviewed" | "accepted" | "rejected";

/** Taxonomic hierarchy down to the binomial itself — shared shape across taxonomy/conflict/synonym data. */
export interface TaxonomyClassification {
  kingdom?: string | null;
  phylum?: string | null;
  class?: string | null;
  order?: string | null;
  family?: string | null;
  genus?: string | null;
  species?: string | null;
}

export interface SpeciesIdentity {
  imported_scientific_name?: string;
  imported_common_name?: string;
  occurrence_count?: number;
  event_date?: string;
  [key: string]: unknown;
}

export interface SpeciesEvidenceSource {
  source: "gbif" | "ebird" | "inaturalist" | "literature" | "legacy";
  record_count?: number;
  unique_count?: number;
  latest_observation_date?: string;
  reference_text?: string;
  doi?: string;
  source_link?: string;
  is_verified?: boolean;
  /** Defaults to "active" when absent. "discarded" = a collaborator flagged
   * this source as falsified/unreliable — kept for audit (never deleted),
   * excluded from the Evidence panel's map by default. Set via the
   * `set_evidence_source` RPC, which also logs the action to activity_log. */
  status?: "active" | "discarded";
  /** True for sources added manually through the Evidence panel's "Add
   * source" control, as opposed to ones populated by automated discovery. */
  manually_added?: boolean;
}

/**
 * One historical/accepted name within a species' taxonomic revision group,
 * with its own occurrence counts — preserved as discovered, never merged
 * into the accepted taxon's totals. `decision` is a workbench-only
 * annotation; the underlying name/counts are never overwritten by it.
 */
export interface SpeciesRevision {
  taxonKey: number | null;
  scientificName: string;
  status: "accepted" | "synonym" | "doubtful" | "none";
  occurrenceCounts?: Partial<Record<SpeciesEvidenceSource["source"], number>>;
  decision?: "merge" | "retain" | "ignore";
}

export interface SpeciesEvidence {
  occurrence_count?: number;
  /** GBIF occurrences for this taxon falling outside the checklist's region
   * boundary — kept separate from `occurrence_count` (which is region-scoped
   * when a region is set) rather than blended into one worldwide total. Only
   * populated when the refresh ran with a resolved region (gadmGid). */
  occurrence_count_outside_region?: number;
  publication_count?: number;
  checklist_matches_count?: number;
  sources?: SpeciesEvidenceSource[];
  external_ids?: Record<string, string | number>;
  basis_of_record_breakdown?: Record<string, number>;
  /** Taxonomic revision history detected during discovery (accepted + historical/synonym names). */
  revisions?: SpeciesRevision[];
  [key: string]: unknown;
}

export interface TaxonomySynonymEvent {
  year?: number;
  event_type: string;
  name: string;
  authority?: string;
  /** Set when this entry was part of an explicit synonym/conflict resolution decision. */
  outcome?: "accepted" | "rejected";
  /** GBIF taxon key for `name`, when available from the backbone lookup that produced this entry. */
  taxon_id?: number | null;
  classification?: TaxonomyClassification | null;
}

export interface TaxonomyAuthorityConflict {
  /** Label for the source of this conflict option (e.g. "GBIF Backbone", "eBird") — NOT a taxonomic authorship string. */
  authority: string;
  suggested_name: string;
  status: "found" | "under_review" | "resolved";
  year?: number | null;
  notes?: string | null;
  /** GBIF taxon key for `suggested_name`, when the conflict came from a backbone/live lookup. */
  taxon_id?: number | null;
  /** Taxonomic authorship string for `suggested_name` (e.g. "(Moore, 1854)"), as recorded by GBIF — usually already includes the year. */
  authorship?: string | null;
  classification?: TaxonomyClassification | null;
}

export interface SpeciesTaxonomy {
  imported_name?: string;
  current_name?: string;
  /** Backbone-accepted canonical name (set for synonym rows). */
  accepted_name?: string;
  /** GBIF taxon ID of the accepted taxon (set for synonym rows). */
  accepted_taxon_id?: number;
  suggested_name?: string;
  gbif_name?: string;
  catalog_of_life_name?: string;
  classification?: TaxonomyClassification;
  /** Authorship of the resolved current/accepted name, captured once at ingestion
   * so the workbench never needs a live backbone re-lookup to display it. */
  authorship?: string;
  /** Year the resolved current/accepted name was published, captured at ingestion. */
  name_published_in_year?: number;
  synonyms?: TaxonomySynonymEvent[];
  authority_conflicts?: TaxonomyAuthorityConflict[];
  /** Taxonomic revision history detected during discovery (accepted + historical/synonym names). */
  revisions?: SpeciesRevision[];
  /** User's explicit resolution decision for an outdated or conflicting name. */
  name_resolution?: {
    decision: "agree" | "disagree" | "defer";
    resolved_by: string;
    resolved_at: string;
    accepted_name?: string;
    resolved_from_authority?: string;
    year?: number;
    authorship?: string;
  };
  [key: string]: unknown;
}

export interface ReviewVotes {
  accept: number;
  reject: number;
  voters?: Array<{ user_id: string; vote: "accept" | "reject"; voted_at: string }>;
}

export interface Species {
  id: string;
  checklist_id: string;
  scientific_name: string;
  common_name: string | null;
  gbif_taxon_key: number | null;
  first_record_year: number | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  evidence_quality: EvidenceQuality;
  taxonomy_status: TaxonomyStatus;
  review_status: ReviewStatus;
  review_votes?: ReviewVotes;
  /**
   * true for normal active rows; false when the row has been merged into
   * another species, ignored, or otherwise superseded. Inactive rows are
   * never deleted — they preserve evidence, review history, and comments
   * for audit and undo.
   */
  is_active: boolean;
  /** UUID of the species row this was merged into, or null. */
  merged_into_species_id: string | null;
  identity: SpeciesIdentity;
  evidence: SpeciesEvidence;
  taxonomy: SpeciesTaxonomy;
  history: unknown[];
  publication: Record<string, unknown>;
  /** Denormalized count of species_comments rows, maintained by a DB trigger. */
  comment_count: number;
  created_at: string;
  updated_at: string;
  /** Every literature paper that contributed evidence for this species (the relational `publications` table, joined in via `getSpecies()`) — unlike `evidence.sources` (one row per source key), this preserves every contributing paper. */
  publications?: Array<{ id: string; title: string; authors: string[] | null; year: number | null; doi: string | null; link: string | null }>;
}
