import { NextResponse } from "next/server";
import {
  fetchRunStatus,
  fetchReviewCandidates,
  fetchCatalog,
  fetchPapersAnalysis,
  type CatalogEntry,
  type LlmAnalysis,
  type ReviewCandidateRecord,
} from "@/lib/research/runResearchPipeline.server";

// Mirrors research-pipeline's runPipeline.ts REVIEW_SCORE_THRESHOLD (and
// DeepSearchDialog.tsx's own copy of the same constant) — kept in sync
// manually since these projects don't share imports. This is what
// `runAnalysisPhase` actually used as "the curated survivors" when Stage B
// ran for this run; the documents/species below must use the exact same
// cutoff, or "what got analyzed" and "what's shown as results" silently
// diverge.
const REVIEW_SCORE_THRESHOLD = 70;

// Mirrors research-pipeline/src/corpus/queryCatalog.ts's matchesRegion —
// substring match, not exact array membership. The corpus accumulates
// across runs with different region-string granularity (e.g. "Darjeeling"
// vs. "Darjeeling district, West Bengal" tagged on the same paper from two
// different runs), so an exact-match filter here would undercount relative
// to wikiBuilder.ts (which already uses this looser match) — keeping both
// consistent matters more than which one is "more correct."
function matchesRegion(entry: CatalogEntry, region: string): boolean {
  const needle = region.toLowerCase();
  return entry.region.some((r) => r.toLowerCase().includes(needle) || needle.includes(r.toLowerCase()));
}

function matchesTaxon(entry: CatalogEntry, taxonGroup: string): boolean {
  const needle = taxonGroup.toLowerCase();
  return entry.taxa.some((t) => t.toLowerCase() === needle);
}

interface SpeciesOccurrence {
  scientificName: string;
  commonName?: string;
  sourceCount: number;
  /** Distinct, in-range occurrence coordinates extracted for this species (deduped) — empty when none were found, never fabricated beyond what the LLM analysis already extracted from the source text. */
  coordinates: Array<{ lat: number; lng: number }>;
  /** Resolved against the local GBIF backbone mirror — see research-pipeline's analysis/backboneMatch.ts. False when unresolved or the backbone wasn't built; never used to drop a species, only to flag it. */
  backboneValidated: boolean;
  /** Advisory-only flag from the end-of-run review pass — flagged if any contributing source flagged it. Never auto-removed. */
  flagged?: boolean;
  flagReason?: string;
  /** The distinct papers that mentioned this species — title/year/link, deduped by slug. Powers both the "Add to Checklist" literature evidence (one record per paper) and the date-range stat in the wizard, and lets the dialog's species table show exactly which paper(s) a species came from — e.g. to spot and remove a flagged off-region source contributing species that don't belong. */
  documents: Array<{ title: string; year?: number; link?: string; documentFlagged?: boolean }>;
}

/** Aggregates species mentions + any occurrence coordinates (from each entry's latest LLM analysis snapshot) across the given entries, counting distinct documents per species — not total mentions. */
function aggregateSpecies(entries: CatalogEntry[], analysisBySlug: Map<string, LlmAnalysis | null>): SpeciesOccurrence[] {
  const speciesMap = new Map<
    string,
    {
      scientificName: string;
      commonName?: string;
      sources: Set<string>;
      documents: Map<string, { title: string; year?: number; link?: string; documentFlagged?: boolean }>;
      coordinates: Map<string, { lat: number; lng: number }>;
      backboneValidated: boolean;
      flagged: boolean;
      flagReason?: string;
    }
  >();
  for (const e of entries) {
    const analysis = analysisBySlug.get(e.slug);
    for (const sp of analysis?.species ?? []) {
      // Dedup key: the GBIF-resolved accepted name when this is a known
      // synonym, falling back to the extracted name otherwise — keying on
      // the raw extracted string let a synonym and its accepted name
      // count as two separate species (research-pipeline's
      // analysis/gbifEnrichment.ts always computes acceptedScientificName
      // but, before this fix, nothing here ever consumed it).
      const key = sp.acceptedScientificName ?? sp.scientificName;
      const existing = speciesMap.get(key) ?? {
        scientificName: key,
        commonName: sp.commonName ?? sp.backboneCommonName,
        sources: new Set<string>(),
        documents: new Map<string, { title: string; year?: number; link?: string; documentFlagged?: boolean }>(),
        coordinates: new Map<string, { lat: number; lng: number }>(),
        backboneValidated: false,
        flagged: false,
      };
      existing.sources.add(e.slug);
      existing.documents.set(e.slug, {
        title: e.title,
        year: e.year,
        link: e.doi ? `https://doi.org/${e.doi}` : e.url,
        // Either signal a document can be flagged by — the end-of-run
        // review pass (e.flagged) or a low region-relevance score — so
        // the species table can surface "this species' only source looks
        // off-region" without the user having to cross-reference the
        // Documents tab manually.
        documentFlagged: Boolean(e.flagged) || (e.region_relevance ?? 100) < 40,
      });
      if (sp.backboneValidated) existing.backboneValidated = true;
      if (sp.flagged) {
        existing.flagged = true;
        existing.flagReason = sp.flagReason;
      }
      // Coordinates are correlated against this same paper's species list
      // by the ORIGINAL extracted name (analysis/coordinateExtraction.ts
      // never sees the accepted-name remap) — matched here, inside the
      // same per-species iteration, rather than via a second pass keyed
      // by the dedup key, which would silently drop every synonym
      // species's coordinates once the key stopped matching coord.species.
      for (const coord of analysis?.coordinates ?? []) {
        if (coord.species !== sp.scientificName || coord.outOfRangeSuspect) continue;
        existing.coordinates.set(`${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`, { lat: coord.lat, lng: coord.lng });
      }
      speciesMap.set(key, existing);
    }
  }
  return [...speciesMap.values()].map((s) => ({
    scientificName: s.scientificName,
    commonName: s.commonName,
    sourceCount: s.sources.size,
    documents: [...s.documents.values()],
    coordinates: [...s.coordinates.values()],
    backboneValidated: s.backboneValidated,
    flagged: s.flagged,
    flagReason: s.flagReason,
  }));
}

// Reads research-pipeline's run status (over HTTP, from the standalone
// service on the DigitalOcean droplet — see runResearchPipeline.server.ts)
// + (once done) a composed "deep search results" summary for the dialog —
// never blocks on the run itself; this just reads whatever's currently there.
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const status = await fetchRunStatus(runId);
  if (!status) {
    return NextResponse.json({ error: `No run found for ${runId}` }, { status: 404 });
  }

  // The review pool is written once, at the end of Stage A (discovery), and
  // stays relevant through Stage B (it's what defines "the curated
  // survivors") — read it whenever it exists, not just in the
  // "awaiting_review" phase specifically, so the dialog can keep showing
  // what's being analyzed once Stage B starts.
  const reviewRecords = await fetchReviewCandidates(runId);
  const reviewCandidates = reviewRecords?.map((c: ReviewCandidateRecord) => ({
    slug: c.metadata.slug,
    title: c.metadata.title,
    authors: c.metadata.authors,
    year: c.metadata.year,
    link: c.metadata.doi ? `https://doi.org/${c.metadata.doi}` : c.metadata.url,
    score: c.score,
    regionScore: c.regionScore,
    taxonScore: c.taxonScore,
    documentType: c.documentType,
    citable: c.citable,
    greySignalCredible: c.greySignalCredible,
    speciesRecordScore: c.speciesRecordScore,
    accessibilityScore: c.accessibilityScore,
    excluded: c.excluded,
  }));

  if (status.phase !== "done") {
    return NextResponse.json({ status, reviewCandidates });
  }

  // The catalog accumulates papers across EVERY run ever started, for any
  // region/taxon — `matchesRegion`/`matchesTaxon` below match loosely
  // (substring) on purpose (see their own doc comments), which is correct
  // for "is this paper relevant to this region/taxon at all" but far too
  // broad for "what did THIS run actually produce." Left unscoped, a run
  // that curated and analyzed 8 papers could show 300+ documents/species
  // here — every loosely-matching paper any other run (or dev/test run)
  // ever cataloged for an overlapping region string, regardless of whether
  // this run's own review gate ever saw or approved it. Scope discovered
  // (non-manual) entries down to this run's own curated survivors — the
  // exact slugs `runAnalysisPhase` (research-pipeline's pipeline/runPipeline.ts)
  // actually read full text for and ran extraction against. Manually
  // contributed papers aren't tied to any one run (they're scoped to
  // region+taxon directly, same as the catalog match itself), so they stay
  // included regardless of survivorSlugs.
  const survivorSlugs = new Set(
    (reviewRecords ?? [])
      .filter((c) => !c.excluded && c.score >= REVIEW_SCORE_THRESHOLD)
      .map((c) => c.metadata.slug),
  );

  const catalog = await fetchCatalog();
  const entries: CatalogEntry[] = catalog.filter(
    (e) =>
      !e.excluded &&
      matchesRegion(e, status.region) &&
      matchesTaxon(e, status.taxonGroup) &&
      (e.discoveredVia === "manual" || survivorSlugs.has(e.slug)),
  );

  // Sort region- and taxon-specific matches first (both computed even
  // without an LLM — see analysis/regionSpecificity.ts and
  // taxonSpecificity.ts), then by overall relevance. Crossref/OpenAlex's
  // keyword search can surface clearly off-topic results (an encyclopedia
  // entry literally titled "Darjeeling", a book chapter titled
  // "Introduction") that match on keyword overlap alone — sorting these to
  // the bottom (instead of mixing them in) is what these two checks are for.
  const sortedByRelevance = [...entries].sort((a, b) => {
    const regionDiff = (b.region_relevance ?? 50) - (a.region_relevance ?? 50);
    if (regionDiff !== 0) return regionDiff;
    const taxonDiff = (b.taxon_relevance ?? 50) - (a.taxon_relevance ?? 50);
    if (taxonDiff !== 0) return taxonDiff;
    return (b.llm_relevance ?? 0) - (a.llm_relevance ?? 0);
  });

  // One batched fetch for every entry's latest LLM analysis — used by the
  // documents table, the species aggregation, and manual-contribution
  // listing below, instead of three separate per-paper round trips.
  const analysisBySlug = await fetchPapersAnalysis(entries.map((e) => e.slug));

  // Full documents table — title/year/authors/type/links, for the dialog's
  // tabular view + clickable source links (DOI preferred, falls back to
  // the raw URL Scholar returned). speciesCount is this document's OWN
  // extraction count (not the cross-document aggregates below) — added
  // specifically so "0 species" in the aggregate tables can be cross-checked
  // against "how many documents even had any extracted" per row.
  const documents = sortedByRelevance.map((e) => {
    const analysis = analysisBySlug.get(e.slug);
    return {
      slug: e.slug,
      title: e.title,
      authors: e.authors,
      year: e.year,
      relevance: e.llm_relevance,
      regionRelevance: e.region_relevance,
      taxonRelevance: e.taxon_relevance,
      documentType: e.documentType,
      greySignalCredible: e.greySignalCredible,
      hasCoordinates: e.has_coordinates,
      speciesCount: analysis?.species?.length ?? 0,
      link: e.doi ? `https://doi.org/${e.doi}` : e.url,
      flagged: e.flagged,
      flagReason: e.flagReason,
    };
  });

  const possiblyOffRegionCount = entries.filter((e) => (e.region_relevance ?? 100) < 40).length;
  const possiblyWrongTaxonCount = entries.filter((e) => (e.taxon_relevance ?? 100) < 40).length;

  // Species table — aggregated from each matching paper's latest LLM
  // analysis snapshot (only populated when NVIDIA_API_KEY is configured;
  // see status.llmEnabled). Read directly from raw/, not duplicated into
  // catalog/ (catalog stays a flat per-paper index, not per-species).
  //
  // Used to also exclude region-"unverified" entries (no full text ever
  // resolved, so regionContainment.ts never got to confirm/deny the region)
  // from species specifically — back when `entries` itself was an
  // unscoped, loosely keyword-matched catalog-wide query (see git history),
  // that was the only signal available to keep wildly-irrelevant abstract
  // matches from inflating species counts. Now that `entries` is already
  // scoped to survivorSlugs above (this run's own curated, reviewed,
  // score-passing candidates — or manual contributions), that concern is
  // handled at the source; re-filtering by containment here only threw away
  // real evidence from exactly the literature this tool most needs to
  // surface — older/paywalled regional checklists whose full text can't be
  // fetched, so containment can only ever report "unverified" for them,
  // never "within". A curated survivor's species now count regardless of
  // containment verdict; "broader"/"unrelated" papers were already
  // hard-dropped before ever reaching the catalog (see research-pipeline's
  // pipeline/runPipeline.ts), so nothing actually off-region survives to
  // reach this aggregation in the first place.
  const species = aggregateSpecies(entries, analysisBySlug).sort((a, b) =>
    a.scientificName.localeCompare(b.scientificName),
  );

  // Manually-contributed papers for this region+taxon — listed with their
  // own species + a region/taxon-mismatch flag (never filtered out; the
  // user explicitly asked for "flag it like out of region data, but do not
  // manually remove it" — removal is only ever an explicit user action via
  // the DELETE route).
  const manualEntries = entries.filter((e) => e.discoveredVia === "manual");
  const manualContributions = manualEntries.map((e) => {
    const analysis = analysisBySlug.get(e.slug);
    return {
      slug: e.slug,
      title: e.title,
      year: e.year,
      link: e.doi ? `https://doi.org/${e.doi}` : e.url,
      regionRelevance: e.region_relevance,
      taxonRelevance: e.taxon_relevance,
      possiblyOffRegion: (e.region_relevance ?? 100) < 40,
      possiblyWrongTaxon: (e.taxon_relevance ?? 100) < 40,
      species: (analysis?.species ?? []).map((sp) => ({
        scientificName: sp.scientificName,
        commonName: sp.commonName,
        backboneValidated: sp.backboneValidated,
      })),
    };
  });

  return NextResponse.json({
    status,
    reviewCandidates,
    results: {
      llmEnabled: status.llmEnabled ?? false,
      documentsFound: entries.length,
      scientificPapersFound: entries.filter((e) => e.documentType === "scientific_paper").length,
      possiblyOffRegionCount,
      possiblyWrongTaxonCount,
      documents,
      species,
      manualContributions,
    },
  });
}
