/** How a paper entered the corpus — see discovery/multiSourceDiscovery.ts (which runs scholarSearch.ts + the curated/Crossref/OpenAlex sources, each isolated), discovery/citationExpansion.ts, and discovery/manualContribution.ts. */
export type DiscoveredVia =
  | "scholar_search"
  | "curated_web_search"
  | "crossref_search"
  | "openalex_search"
  | "citation_expansion"
  | "manual";

/** Raw shape returned by ScholarMCP's search_google_scholar_key_words/_advanced tools. */
export interface ScholarSearchResult {
  Title: string;
  Authors?: string;
  Abstract?: string;
  URL?: string;
  Year?: number;
  CitedBy?: number;
  CitedByURL?: string;
  RelatedArticlesURL?: string;
  Versions?: number;
  VersionsURL?: string;
  PDFURL?: string;
}

/** A paper candidate before/while it's being resolved into the raw/ corpus. */
export interface PaperCandidate {
  slug: string;
  title: string;
  doi?: string;
  year?: number;
  authorsLine?: string;
  discoveredVia: DiscoveredVia;
  expandedFrom?: string;
  scholar?: ScholarSearchResult;
  url?: string;
}

export type FullTextStatus =
  | "extracted"
  | "extracted_empty"
  | "extracted_garbled"
  | "metadata_only"
  | "paywalled_skipped";

/** Merged metadata.json shape for a paper in raw/papers/<slug>/. */
export interface PaperMetadata {
  slug: string;
  title: string;
  doi?: string;
  year?: number;
  authors?: string;
  venue?: string;
  abstract?: string;
  url?: string;
  discoveredVia: DiscoveredVia;
  expandedFrom?: string;
  /** Snapshot as of metadata creation (always "metadata_only" then) — metadata.json is immutable, so the *current* status lives in the sibling fulltext_status.json the full-text phase writes instead of mutating this. */
  fullTextStatus: FullTextStatus;
  citedByCount?: number;
  /** From OpenAlex's open_access flag, captured during Stage A enrichment — free, no extra network call (same getWorkByDoi lookup already fetches abstract/venue). Used by analysis/accessibilitySignal.ts so the review pool can rank down sources we have no real way to read. */
  isOa?: boolean;
  oaUrl?: string;
  createdAt: string;
}

/**
 * One entry in a run's pre-fulltext review pool (raw/runs/<runId>-candidates.json)
 * — what the "awaiting_review" pause shows the user before any full-text
 * fetch or LLM call happens. `excluded` is the user's curation decision
 * during review; `score` below 70 means it was filtered from the
 * surfaced/default list automatically (quality-over-volume), not removed by
 * the user — both are tracked separately so "why isn't this here" is always
 * answerable from this one record.
 */
export interface ReviewCandidate {
  metadata: PaperMetadata;
  score: number;
  regionScore: number;
  taxonScore: number;
  documentType: DocumentType;
  citable: boolean;
  greySignalCredible?: boolean;
  /** 0-100: does this look like actual species-record literature vs. region/taxon keywords showing up incidentally (e.g. a tourism book) — see analysis/speciesRecordSignal.ts. */
  speciesRecordScore: number;
  /** 0-100: cheap estimate of whether full text is likely obtainable — see analysis/accessibilitySignal.ts. */
  accessibilityScore: number;
  excluded: boolean;
}

/** raw/papers/<slug>/fulltext_status.json — the one source of truth for current full-text state, written once by fulltext/resolveFullText.ts. */
export interface FullTextStatusRecord {
  status: FullTextStatus;
  resolvedVia?: "unpaywall" | "core" | "bhl_ocr" | "discovered_url" | "manual_upload" | "manual_url" | "none";
  textLength?: number;
  resolvedAt: string;
}

export interface RegionQuery {
  region: string;
  taxonGroup: string;
}

export interface EcoregionOverlap {
  ecoName: string;
  biomeName: string;
  realm: string;
  overlapFraction: number;
}

export interface EcologicalProfile {
  regionName: string;
  ecoregions: EcoregionOverlap[];
  dominantBiome: string | null;
  dominantRealm: string | null;
  generatedAt: string;
}

export interface CoordinateMention {
  species?: string;
  lat: number;
  lng: number;
  locality?: string;
  sourceSentence?: string;
  outOfRangeSuspect?: boolean;
}

export interface LlmAnalysis {
  paperSlug: string;
  analyzedAt: string;
  semanticRanking?: number;
  regionRelevance?: number;
  taxonRelevance?: number;
  historicalImportance?: number;
  isChecklist?: boolean;
  documentType?: DocumentType;
  checklistReasons?: string[];
  greySignalCredible?: boolean;
  greySignalReasons?: string[];
  species?: ExtractedSpeciesRecord[];
  coordinates?: CoordinateMention[];
  localities?: Array<{ name: string; lat?: number; lng?: number; species?: string }>;
}

/** Per-species record carrying the new bulk-extraction fields (occurrence/location/dateRange) on top of the original scientificName/commonName/sourceSentence shape. */
export interface ExtractedSpeciesRecord {
  scientificName: string;
  commonName?: string;
  sourceSentence?: string;
  backboneValidated?: boolean;
  /** e.g. "resident" | "migrant" | "vagrant" | "historical_record" | "unspecified" — only ever a value literally stated/implied by the text, never inferred from general species knowledge. */
  occurrence?: string;
  /** Free-text locality as stated in the source (e.g. "Tiger Hill, Darjeeling") — distinct from the geocoded CoordinateMention/locality records, which require a resolvable lat/lng. */
  location?: string;
  dateRange?: { from?: string; to?: string };
  /** From the local GBIF backbone (analysis/gbifEnrichment.ts) — taxon_rank, e.g. "species"/"subspecies". */
  taxonRank?: string;
  /** From the local GBIF backbone — "accepted" | "synonym" | "doubtful". */
  taxonomicStatus?: string;
  /** Preferred-English common name resolved from the local GBIF backbone — distinct from `commonName`, which (when present) came from the source text itself, never invented/looked-up. */
  backboneCommonName?: string;
  /** Full taxonomic classification resolved from the local GBIF backbone. */
  classification?: {
    kingdom?: string;
    phylum?: string;
    class?: string;
    order?: string;
    family?: string;
    genus?: string;
  };
  /**
   * When `taxonomicStatus === "synonym"`, the backbone's accepted-name
   * resolution — informational only. Deliberately does NOT overwrite
   * `scientificName`: what the source literally said is never silently
   * replaced by a synonym's accepted name.
   */
  acceptedScientificName?: string;
  /**
   * Advisory-only flag from the end-of-run LLM review pass
   * (analysis/finalReviewPass.ts) — a species that looks implausible for
   * the region/taxon. Never causes removal; surfaced for human review only.
   */
  flagged?: boolean;
  flagReason?: string;
}

export type DocumentType = "checklist" | "scientific_paper" | "other";

export interface CatalogEntry {
  slug: string;
  title: string;
  doi?: string;
  url?: string;
  authors?: string;
  year?: number;
  /** APA-style reference rendered from authors/year/title/venue/doi/url via corpus/citationFormatter.ts — recomputed on every catalog rebuild (catalog/ is freely regenerable), so formatter improvements apply retroactively without touching raw/. */
  citation?: string;
  scholar_rank?: number;
  llm_relevance?: number;
  /** 0-100: does this document actually concern the *most specific* part of the region (e.g. a district), not just its broader state/country — see analysis/regionSpecificity.ts. Computed even without an LLM configured. */
  region_relevance?: number;
  /** 0-100: does this document actually concern the requested taxon group (or a recognized common-name synonym) — see analysis/taxonSpecificity.ts. Computed even without an LLM configured. */
  taxon_relevance?: number;
  /**
   * GIS-grounded check (analysis/regionContainment.ts) of whether the
   * paper's stated study area is geographically contained within the target
   * region, as opposed to just textually mentioning its name:
   * "within" = candidate locality resolves inside the target boundary;
   * "broader" = candidate locality's own area is bigger than the target's
   * (e.g. a state-wide paper for a district-level search);
   * "unrelated" = candidate locality resolves but doesn't overlap the target;
   * "unverified" = no full text to check against (e.g. paywalled/abstract-only) —
   * kept, not dropped, since this reflects missing evidence, not a failed check.
   */
  regionContainment?: "within" | "broader" | "unrelated" | "unverified";
  region: string[];
  taxa: string[];
  /** Grading axis (b): checklist vs. scientific_paper vs. other (grey/non-scientific) — see analysis/checklistDetection.ts. */
  documentType: DocumentType;
  /** Grading axis (c): only meaningful when documentType === "other" — whether the document still carries credible region+taxon signal worth surfacing rather than discarding. */
  greySignalCredible?: boolean;
  historical: boolean;
  has_coordinates: boolean;
  discoveredVia: DiscoveredVia;
  expandedFrom?: string | null;
  fullTextStatus: FullTextStatus;
  updatedAt: string;
  /**
   * Soft-delete: the user explicitly excluded this document from the
   * Documents/Species listing for a region+taxon run after reviewing it —
   * not a data-quality verdict the pipeline computed itself. raw/ and this
   * catalog entry are kept intact (provenance, re-runs can still touch it),
   * only query/output aggregation skips it (see queryCatalog.ts,
   * outputsBuilder.ts). Distinct from manual-contribution removal
   * (manualContribution.ts's removeManualContribution), which hard-deletes
   * and is restricted to discoveredVia: "manual" — this is the opposite
   * case, for discovered literature specifically, and is always reversible.
   */
  excluded?: boolean;
  /**
   * Advisory-only flag from the end-of-run LLM review pass
   * (analysis/finalReviewPass.ts) — this whole document looked off-topic
   * for the region/taxon. Distinct from `excluded`, which is the user's own
   * deliberate removal decision — a flag is never auto-removed, just
   * surfaced for human review.
   */
  flagged?: boolean;
  flagReason?: string;
}

export type RunPhase =
  | "starting"
  | "discovery"
  | "enrichment"
  | "citation_expansion"
  /** Scoring every surviving candidate via preliminaryRelevance.ts — brief (synchronous, no network/LLM call) but reported as its own phase so the live UI can show "Searching" and "Ranking" as distinct steps instead of one undifferentiated spinner. */
  | "ranking"
  /**
   * The pipeline pauses here: discovery + non-LLM ranking (see
   * preliminaryRelevance.ts) is done, full-text resolution and LLM analysis
   * have NOT started yet. Stays in this phase until the app calls the
   * separate "continue" trigger (runAnalysisPhase) with the user's curated
   * survivor set — see corpus/reviewStore.ts.
   */
  | "awaiting_review"
  /** Resolves full text AND runs the local (non-LLM by default) species-extraction cascade for each paper in the same loop — see analysis/analyzePaper.ts. */
  | "fulltext"
  | "ecology"
  /** Enriches each paper's already-extracted species with local GBIF backbone data (common name, classification, synonym resolution) — see analysis/gbifEnrichment.ts. No LLM call by default; renamed from "llm_analysis" since this phase no longer calls one. */
  | "gbif_enrichment"
  | "catalog"
  /** One fast, lightweight end-of-run LLM pass over the whole corpus's species+document list, flagging anything that looks wrong — see analysis/finalReviewPass.ts. Advisory only; gracefully no-ops without an LLM configured. */
  | "review"
  | "wiki"
  | "outputs"
  | "done"
  | "error";

export interface SourceOutcome {
  source: "scholar" | "curated_web_search" | "crossref" | "openalex";
  status: "ok" | "empty" | "error";
  count: number;
  message?: string;
}

export interface RunStatus {
  runId: string;
  region: string;
  taxonGroup: string;
  phase: RunPhase;
  startedAt: string;
  updatedAt: string;
  counts: Record<string, number>;
  error?: string;
  /** Whether NVIDIA_API_KEY was configured for this run — relevance scoring, historical-importance, species/coordinate extraction, and grey-literature credibility all silently fall back to neutral defaults without it. Recorded so consumers (the live UI dialog) can explain low/zero counts honestly instead of looking broken. */
  llmEnabled: boolean;
  /** Per-source discovery outcome (Phase A) — each source is isolated, so one failing (e.g. Scholar's 429s) never aborts the run; this is what lets the live UI show "Scholar: failed (blocked)" alongside "Curated web: 12 found" instead of an opaque whole-run failure. */
  sourceOutcomes?: SourceOutcome[];
}
