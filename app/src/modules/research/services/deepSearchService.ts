export type DeepSearchPhase =
  | "starting"
  | "discovery"
  | "enrichment"
  | "citation_expansion"
  /** Brief scoring pass (research-pipeline's preliminaryRelevance.ts) — reported separately from discovery/enrichment so the UI can show "Ranking" as its own step. */
  | "ranking"
  /** The pipeline pauses here — see research-pipeline's RunPhase doc comment. reviewCandidates below is populated once status reaches this phase. */
  | "awaiting_review"
  /** Resolves full text AND runs the local species-extraction cascade in the same loop — see research-pipeline's analysis/analyzePaper.ts. */
  | "fulltext"
  | "ecology"
  /** No-LLM GBIF backbone enrichment (common name, classification, synonym resolution) of the already-extracted species list — renamed from "llm_analysis" since this phase no longer calls an LLM by default. See research-pipeline's analysis/gbifEnrichment.ts. */
  | "gbif_enrichment"
  | "catalog"
  /** One fast end-of-run LLM pass flagging implausible species/documents across the whole corpus — advisory only. See research-pipeline's analysis/finalReviewPass.ts. */
  | "review"
  | "wiki"
  | "outputs"
  | "done"
  | "error";

export type DeepSearchDocumentType = "checklist" | "scientific_paper" | "other";

/** One entry in the pre-fulltext review pool — mirrors research-pipeline's ReviewCandidate. */
export interface ReviewCandidate {
  slug: string;
  title: string;
  authors?: string;
  year?: number;
  link?: string;
  score: number;
  regionScore: number;
  taxonScore: number;
  documentType: DeepSearchDocumentType;
  citable: boolean;
  greySignalCredible?: boolean;
  /** 0-100: does this look like actual species-record literature vs. region/taxon keywords showing up incidentally (e.g. a tourism book) — see research-pipeline's analysis/speciesRecordSignal.ts. */
  speciesRecordScore: number;
  /** 0-100: cheap estimate of whether full text is likely obtainable — see research-pipeline's analysis/accessibilitySignal.ts. */
  accessibilityScore: number;
  excluded: boolean;
}

export interface SourceOutcome {
  source: "scholar" | "curated_web_search" | "crossref" | "openalex";
  status: "ok" | "empty" | "error";
  count: number;
  message?: string;
}

export const SOURCE_LABELS: Record<SourceOutcome["source"], string> = {
  scholar: "Google Scholar",
  curated_web_search: "Curated Web Search",
  crossref: "Crossref",
  openalex: "OpenAlex",
};

export interface DeepSearchStatus {
  runId: string;
  region: string;
  taxonGroup: string;
  phase: DeepSearchPhase;
  startedAt: string;
  updatedAt: string;
  counts: Record<string, number>;
  error?: string;
  llmEnabled?: boolean;
  /** Per-source discovery outcome (Scholar/curated web/Crossref/OpenAlex) — each source is isolated, so Scholar's 429s (or any other source failing) never aborts the run; this is what lets the dialog show which sources actually contributed. */
  sourceOutcomes?: SourceOutcome[];
}

export interface DeepSearchDocument {
  slug: string;
  title: string;
  authors?: string;
  year?: number;
  relevance?: number;
  /** 0-100: does this document concern the most specific part of the region asked for, or only a broader parent area (state/country)? Computed even without an LLM — see research-pipeline's analysis/regionSpecificity.ts. Documents are sorted by this first. */
  regionRelevance?: number;
  /** 0-100: does this document actually concern the requested taxon group (or a recognized common-name synonym)? Computed even without an LLM — see research-pipeline's analysis/taxonSpecificity.ts. Documents are sorted by this second. */
  taxonRelevance?: number;
  documentType: DeepSearchDocumentType;
  greySignalCredible?: boolean;
  hasCoordinates: boolean;
  /** This document's own extracted species count (not aggregated across documents) — needs an LLM configured to be non-zero. */
  speciesCount: number;
  /** DOI link when available, else the raw URL Scholar returned — what the source-link icon opens. */
  link?: string;
  /** Advisory-only flag from the end-of-run review pass (research-pipeline's analysis/finalReviewPass.ts) — this document looked off-topic. Never auto-removed. */
  flagged?: boolean;
  flagReason?: string;
}

export interface DeepSearchSpecies {
  scientificName: string;
  commonName?: string;
  sourceCount: number;
  /** Distinct in-range occurrence coordinates extracted for this species, when any were found in the source text — never fabricated, just empty when none were found. */
  coordinates: Array<{ lat: number; lng: number }>;
  /** Resolved against the local GBIF backbone mirror (research-pipeline's analysis/backboneMatch.ts) — false when unresolved, never used to drop a species, only to flag it. */
  backboneValidated: boolean;
  /** Advisory-only flag from the end-of-run review pass — this species looked implausible for the region/taxon in at least one contributing source. Never auto-removed. */
  flagged?: boolean;
  flagReason?: string;
  /** The distinct papers that mentioned this species (title/year/link) — feeds the "Add to Checklist" literature evidence, the date-range stat, and lets the dialog's species table show which paper(s) a species traces back to (documentFlagged surfaces a flagged/off-region source without cross-referencing the Documents tab). */
  documents: Array<{ title: string; year?: number; link?: string; documentFlagged?: boolean }>;
}

export interface ManualContribution {
  slug: string;
  title: string;
  year?: number;
  link?: string;
  regionRelevance?: number;
  taxonRelevance?: number;
  /** Flagged, never auto-removed — removal is only ever the explicit user action of deleting a contribution (see removeContribution below). */
  possiblyOffRegion: boolean;
  possiblyWrongTaxon: boolean;
  species: Array<{ scientificName: string; commonName?: string; backboneValidated?: boolean }>;
}

export interface DeepSearchResults {
  /** Whether NVIDIA_API_KEY was configured for this run. When false, relevance/historical-importance/species-coordinates/grey-lit-credibility all ran in graceful-fallback mode (mostly 0/neutral) rather than reflecting an actual absence of such literature — surfaced so the UI can explain that honestly. */
  llmEnabled: boolean;
  documentsFound: number;
  scientificPapersFound: number;
  /** Documents whose regionRelevance is below 40 — likely about the region's broader parent area, not the specific place asked for. Still listed (never silently dropped), just sorted last and flagged. */
  possiblyOffRegionCount: number;
  /** Documents whose taxonRelevance is below 40 — likely off-topic results a keyword search matched loosely (e.g. an encyclopedia entry or book chapter that happens to mention the region/checklist terms). Still listed, sorted last and flagged. */
  possiblyWrongTaxonCount: number;
  documents: DeepSearchDocument[];
  species: DeepSearchSpecies[];
  manualContributions: ManualContribution[];
}

export interface DeepSearchStatusResponse {
  status: DeepSearchStatus;
  results?: DeepSearchResults;
  /** Populated once status.phase reaches "awaiting_review" — the ranked pre-fulltext pool for the user to curate before Stage B starts. */
  reviewCandidates?: ReviewCandidate[];
}

/**
 * Client for the research-pipeline deep-search trigger. The pipeline itself
 * is a physically separate standalone project (../research-pipeline) — this
 * just calls the two thin API routes that spawn/poll it. See
 * research-pipeline/README.md "Design notes" for why it's kept separate.
 */
export async function startDeepSearch(
  region: string,
  taxonGroup: string,
  resultsPerQuery?: number,
): Promise<{ runId: string }> {
  const response = await fetch("/api/research/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region, taxonGroup, resultsPerQuery }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to start deep search: ${response.status}`);
  }
  return response.json();
}

export async function getDeepSearchStatus(runId: string): Promise<DeepSearchStatusResponse> {
  const response = await fetch(`/api/research/run/${runId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch deep search status: ${response.status}`);
  }
  return response.json();
}

/** Excludes (or restores) a candidate from the pre-fulltext review pool — see research-pipeline's corpus/reviewStore.ts. Reversible, never touches raw/. */
export async function excludeReviewCandidate(runId: string, slug: string, excluded: boolean): Promise<void> {
  const response = await fetch(`/api/research/run/${runId}/exclude-candidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, excluded }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to update candidate: ${response.status}`);
  }
}

/** Kicks off Stage B (full text -> LLM analysis -> catalog/wiki/outputs) for whichever candidates survived review — see research-pipeline's runAnalysisPhase. Detached/polled the same way as startDeepSearch; the caller should keep polling getDeepSearchStatus afterward. */
export async function continueDeepSearch(runId: string): Promise<void> {
  const response = await fetch(`/api/research/run/${runId}/continue`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to continue run: ${response.status}`);
  }
}

/** Contributes a pasted link for a paper the user thinks should be included — ingested through the same analysis pipeline, tagged as a manual contribution (see research-pipeline/src/discovery/manualContribution.ts). */
export async function contributeUrl(region: string, taxonGroup: string, url: string): Promise<ManualContribution> {
  const response = await fetch("/api/research/contribute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region, taxonGroup, url }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to contribute link: ${response.status}`);
  }
  const body = (await response.json()) as { entry: unknown };
  return toManualContribution(body.entry);
}

/** Contributes a dropped PDF file the same way. */
export async function contributeFile(region: string, taxonGroup: string, file: File): Promise<ManualContribution> {
  const form = new FormData();
  form.set("region", region);
  form.set("taxonGroup", taxonGroup);
  form.set("file", file);

  const response = await fetch("/api/research/contribute", { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to contribute file: ${response.status}`);
  }
  const body = (await response.json()) as { entry: unknown };
  return toManualContribution(body.entry);
}

/** The contribute route's `entry` is research-pipeline's raw CatalogEntry shape — newly-ingested, so it has no species/llm_analysis read attached yet (that only shows up once the dialog re-fetches run status). Normalizes it to ManualContribution with an empty species list and a freshly-computed flag, just so it can be optimistically added to the uploaded-papers list immediately. */
function toManualContribution(raw: unknown): ManualContribution {
  const entry = raw as {
    slug: string;
    title: string;
    year?: number;
    doi?: string;
    url?: string;
    region_relevance?: number;
    taxon_relevance?: number;
  };
  return {
    slug: entry.slug,
    title: entry.title,
    year: entry.year,
    link: entry.doi ? `https://doi.org/${entry.doi}` : entry.url,
    regionRelevance: entry.region_relevance,
    taxonRelevance: entry.taxon_relevance,
    possiblyOffRegion: (entry.region_relevance ?? 100) < 40,
    possiblyWrongTaxon: (entry.taxon_relevance ?? 100) < 40,
    species: [],
  };
}

/**
 * Soft-deletes (excluded: true) or restores (excluded: false) a *discovered*
 * document from this region+taxon's Documents/Species listing — distinct
 * from removeContribution below, which hard-deletes and only ever applies
 * to manual contributions. Reversible: the underlying evidence in
 * research-pipeline's raw/ and catalog/ is never touched, only its
 * inclusion in aggregated results.
 */
export async function setDocumentExcluded(slug: string, excluded: boolean): Promise<void> {
  const response = await fetch("/api/research/exclude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, excluded }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to update document: ${response.status}`);
  }
}

/** Withdraws a manually-contributed paper. The server refuses (in research-pipeline) to touch anything not tagged discoveredVia: "manual" — this can never remove discovered literature. */
export async function removeContribution(slug: string): Promise<void> {
  const response = await fetch("/api/research/contribute", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to remove contribution: ${response.status}`);
  }
}
