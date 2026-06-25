import type { SourceKey } from "@/modules/evidence/discovery/types";
import type {
  SpeciesRevision,
  SpeciesEvidenceSource,
  TaxonomyAuthorityConflict,
  TaxonomySynonymEvent,
} from "@/types/species.types";
import type { Profile } from "@/types/collaboration.types";

export type ChecklistStatus =
  | "draft"
  | "importing"
  | "validating"
  | "reviewing"
  | "published"
  | "archived";

export interface TaxonomicScope {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

export interface Checklist {
  id: string;
  title: string;
  region_name: string | null;
  region_country: string | null;
  region_state: string | null;
  region_district: string | null;
  region_gadm_id: string | null;
  region_osm_type: string | null;
  region_osm_id: string | null;
  region_pin: string | null;
  taxonomic_scope: TaxonomicScope;
  status: ChecklistStatus;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateChecklistSpeciesInput {
  scientific_name: string;
  common_name?: string;
  /** Every distinct common name reported across contributing sources (including
   * `common_name` itself) — e.g. "Medium Egret" vs "Intermediate Egret" for the
   * same taxon. Used as extra fallback candidates when backbone enrichment by
   * `common_name` alone doesn't resolve. */
  alternate_common_names?: string[];
  occurrence_count?: number;
  event_date?: string;
  /** GBIF accepted backbone taxon key, when resolved during discovery. */
  gbif_taxon_key?: number | null;
  /** Canonical (accepted) name, when resolved during discovery. */
  canonical_name?: string;
  classification?: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
  };
  /** Evidence sources that contributed this species during discovery. */
  sources?: SourceKey[];
  /** Per-source occurrence counts for the accepted taxon. */
  occurrence_counts?: Partial<Record<SourceKey, number>>;
  /** Per-source deep link to view this species on the source's own site (GBIF/iNat/eBird taxon page, literature URL/DOI). */
  source_links?: Partial<Record<SourceKey, string>>;
  /** Taxonomic revision history (accepted + historical/synonym names), never merged. */
  revisions?: SpeciesRevision[];
  /** True when discovery could not match this species to the GBIF backbone. */
  unresolved?: boolean;
  /** Per-source aggregate occurrence/publication counts, for the Workbench Evidence panel. */
  evidence_sources?: SpeciesEvidenceSource[];
  /** External database record links (GBIF/eBird/iNaturalist/etc. record IDs). */
  external_db_records?: Array<{
    source: SourceKey;
    external_id: string;
    record_count?: number;
    last_updated?: string;
  }>;
  /** Literature evidence for this species. */
  publications?: Array<{
    title: string;
    authors?: string[];
    year?: number;
    doi?: string;
    link?: string;
  }>;
  /** Historical mention timeline entries (year/source/note). */
  historical_mentions?: Array<{ year?: number; source?: string; note?: string }>;
  /** Conflicting-authority cards for the Workbench Taxonomy panel. */
  taxonomy_conflicts?: TaxonomyAuthorityConflict[];
  /** Synonym timeline entries for the Workbench Taxonomy panel. */
  taxonomy_synonyms?: TaxonomySynonymEvent[];
  /** Authorship string for the accepted scientific name, e.g. "(Vigors, 1831)". */
  scientific_name_authorship?: string;
  /** Authorship of the resolved current/accepted backbone taxon — stored on every
   * matched row (not just synonym/conflict ones) so the workbench never needs a
   * live backbone re-lookup to display it. */
  current_authorship?: string;
  /** Year the resolved current/accepted backbone taxon's name was published. */
  current_name_published_in_year?: number;
}

export type ChecklistLicense = "CC0-1.0" | "CC-BY-4.0" | "CC-BY-NC-4.0";
export type ContributorRole = "Creator" | "Curator" | "Reviewer" | "Author";

export type GbifEndorsementStatus = "not_started" | "requested" | "endorsed";
export type IptAccessStatus = "not_started" | "requested" | "granted";

/**
 * GBIF endorsement and IPT access belong to a publishing *organization*,
 * not a single checklist, and one org may publish several checklists —
 * this is a standalone, user-owned profile (same ownership pattern as
 * Checklist itself) that a checklist links to via
 * `checklist_metadata.publishing_organization_id`. ChecklistHub never talks
 * to IPT/GBIF programmatically; these fields only track real-world setup
 * status so the "Publish via IPT" step doesn't ask the same questions for
 * every checklist.
 */
export interface PublishingOrganization {
  id: string;
  owner_id: string;
  name: string;
  website: string | null;
  institution_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  endorsement_status: GbifEndorsementStatus;
  endorsement_requested_at: string | null;
  endorsement_notes: string | null;
  ipt_access_status: IptAccessStatus;
  ipt_instance_name: string | null;
  ipt_instance_url: string | null;
  ipt_organization_key: string | null;
  gbif_registry_org_uuid: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistContributor {
  id?: string;
  name: string;
  role: ContributorRole;
  institution?: string | null;
  orcid?: string | null;
  email?: string | null;
}

export interface ChecklistMetadata {
  checklist_id: string;
  keywords: string[];
  language: string;
  short_description: string | null;
  purpose: string | null;
  abstract: string | null;
  dataset_type: string;
  temporal_earliest_year: number | null;
  temporal_latest_year: number | null;
  temporal_coverage_description: string | null;
  geo_country: string | null;
  geo_state: string | null;
  geo_region_name: string | null;
  geo_bounding_box: string | null;
  geo_elevation_range: string | null;
  geo_description: string | null;
  geo_checklist_type: string | null;
  taxonomic_scope_description: string | null;
  methods_data_sources: string[];
  methodology: string | null;
  taxonomic_validation: string | null;
  evidence_evaluation: string | null;
  criteria: string | null;
  reviewer_notes: string | null;
  publishing_organization_id: string | null;
  publishing_org_name: string | null;
  publishing_org_website: string | null;
  institution_code: string | null;
  publishing_contact: string | null;
  resource_contact: string | null;
  license: ChecklistLicense | null;
  rights_statement: string | null;
  usage_notes: string | null;
  dataset_version: string;
  /**
   * GBIF generates the official, citable DOI and citation once this
   * checklist's DwC-A package is published through IPT — ChecklistHub never
   * mints these itself. These three fields just record that official
   * citation after the fact; null until then.
   */
  gbif_doi: string | null;
  gbif_publication_year: number | null;
  gbif_citation: string | null;
  /** GBIF Registry dataset UUID, assigned once registered through IPT. */
  gbif_dataset_uuid: string | null;
  /** When this checklist's IPT/GBIF publication was recorded in ChecklistHub. */
  ipt_published_at: string | null;
  /** When the user marked the IPT-side submission (resource created/published/registered on their IPT) as done, while still waiting on GBIF to assign a dataset UUID — see mark_checklist_submitted_for_review. */
  ipt_submitted_at: string | null;
  /** Whether this checklist was produced under a funded programme/project — gates whether the EML <project> element is emitted. */
  is_funded: boolean;
  /** Programme/project identifier, e.g. "BID-AF2016-0001-REG" — required by GBIF for BID/BIFA/CESP-funded datasets. Maps to EML <project id="...">. */
  project_id: string | null;
  /** Title of the funded project as listed in its contract/grant document. Maps to EML <project><title>. */
  project_title: string | null;
  /** Funder name / grant description. Maps to EML <project><funding><para>. */
  funding_description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChecklistMetadataResponse {
  metadata: ChecklistMetadata | null;
  contributors: ChecklistContributor[];
}

export type PublicationDraftStage = "metadata" | "review" | "ipt";

export interface ChecklistPublicationDraft {
  checklist_id: string;
  stage: PublicationDraftStage;
  package_storage_path: string | null;
  package_generated_at: string | null;
  updated_at: string;
}

export type PublicationCommentDecision = "approve" | "request_changes";

/** "edit" entries are system-logged (from saving an edit to the package preview), distinct from freeform human "comment" entries — see `payload` for structured detail. */
export type PublicationCommentKind = "comment" | "edit";

export interface ChecklistPublicationComment {
  id: string;
  checklist_id: string;
  author_id: string;
  body: string;
  decision: PublicationCommentDecision | null;
  kind: PublicationCommentKind;
  /** Structured detail for "edit" entries, e.g. `{ version_number, file }` — null for plain comments. */
  payload: Record<string, unknown> | null;
  created_at: string;
  author?: Profile;
}

/**
 * One permanent, browsable snapshot of a checklist's publication package —
 * created every time an edit is saved via the package preview's Edit/Save
 * flow (see `PublishPackagePage.tsx`). Append-only; never updated/deleted.
 */
export interface ChecklistPublicationVersion {
  id: string;
  checklist_id: string;
  version_number: number;
  metadata_snapshot: ChecklistMetadata;
  contributors_snapshot: ChecklistContributor[];
  files: { name: string; contents: string }[];
  package_storage_path: string | null;
  change_summary: string;
  created_by: string | null;
  created_at: string;
}

export interface ChecklistPublicationSnapshot {
  id: string;
  checklist_id: string;
  species_count: number;
  family_count: number;
  genus_count: number;
  order_count: number;
  species_ids: string[];
  published_at: string;
  published_by: string | null;
}

export interface CollaboratorInviteInput {
  email: string;
  note?: string;
}

export interface CreateChecklistInput {
  title: string;
  region_name?: string;
  region_country?: string;
  region_state?: string;
  region_district?: string;
  region_gadm_id?: string;
  region_osm_type?: string;
  region_osm_id?: string;
  region_pin?: string;
  taxonomic_scope: TaxonomicScope;
  species: CreateChecklistSpeciesInput[];
  invites: CollaboratorInviteInput[];
}

export type ImportStatus = "pending" | "processing" | "validated" | "failed";

export interface ChecklistImport {
  id: string;
  checklist_id: string;
  file_path: string;
  status: ImportStatus;
  summary: Record<string, unknown>;
  error_log: unknown[];
  created_at: string;
}

export type ImportIssueType =
  | "duplicate_id"
  | "extralimital"
  | "taxonomic_conflict"
  | "synonym"
  | "geospatial"
  | "malformed_row"
  | "invalid_date"
  | "invalid_count"
  | "missing_name"
  | "duplicate_row";

export interface ImportIssue {
  id: string;
  import_id: string;
  species_id: string | null;
  issue_type: ImportIssueType;
  description: string | null;
  payload: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}
