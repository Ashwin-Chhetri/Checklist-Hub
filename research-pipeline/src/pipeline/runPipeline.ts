import { runMultiSourceDiscovery } from "../discovery/multiSourceDiscovery.js";
import { expandViaCitations, type ExpansionSeed } from "../discovery/citationExpansion.js";
import { resolveFullText } from "../fulltext/resolveFullText.js";
import { resolveRegionBoundary, buildRegionHierarchy } from "../regions/resolveRegionBoundary.js";
import { intersectRegion } from "../ecoregions/intersectRegion.js";
import { buildPaperMetadata } from "../corpus/buildPaperMetadata.js";
import { scorePreliminaryRelevance } from "../analysis/preliminaryRelevance.js";
import { checkRegionContainment } from "../analysis/regionContainment.js";
import { analyzePaper } from "../analysis/analyzePaper.js";
import { enrichSpeciesWithBackbone } from "../analysis/gbifEnrichment.js";
import { runFinalReviewPass } from "../analysis/finalReviewPass.js";
import { updateCatalogEntry, applyReviewFlags } from "../corpus/catalogBuilder.js";
import { queryCatalog } from "../corpus/queryCatalog.js";
import { buildWiki } from "../corpus/wikiBuilder.js";
import { buildOutputs } from "../corpus/outputsBuilder.js";
import { createRunStatusTracker, loadRunStatusTracker } from "../corpus/runStatus.js";
import { writeReviewCandidates, readReviewCandidates } from "../corpus/reviewStore.js";
import {
  writeScholarSearchRaw,
  listPaperSlugs,
  readExtractedText,
  writeLlmAnalysisSnapshot,
  readLatestLlmAnalysis,
} from "../corpus/rawStore.js";
import { AdaptiveConcurrencyGate, mapWithAdaptiveConcurrency } from "../util/adaptiveConcurrency.js";
import { consumeRecentThrottleSignal } from "../util/httpSignals.js";
import type { PaperCandidate, PaperMetadata, ReviewCandidate, LlmAnalysis } from "../types.js";

// I/O-bound work (network calls to Crossref/OpenAlex/Semantic Scholar) —
// bounded concurrency cuts wall-clock time substantially vs. a plain
// sequential loop, without hammering any single API. Adaptive rather than a
// guessed fixed number (the old ENRICHMENT_CONCURRENCY=5/FULLTEXT_CONCURRENCY=3
// constants) — same widen-on-success/narrow-on-throttle shape as
// analysis/llmClient.ts's per-lane state, fed by util/httpSignals.ts's 429/503
// detection at each source's fetch call. Each gate's `initial` mirrors the
// constant it replaces, so a fresh process starts at the same pace as before
// and only drifts once it's actually seen real behavior from these APIs.
const enrichmentGate = new AdaptiveConcurrencyGate({ floor: 2, ceiling: 10, initial: 5 });
const fullTextGate = new AdaptiveConcurrencyGate({ floor: 1, ceiling: 8, initial: 3 });
// Region containment resolves locality names via the same Nominatim
// geocoder used for region boundaries — kept low and FIXED (floor ===
// ceiling, so reportSuccess/reportThrottled never move it) out of the same
// politeness convention as resolveRegionBoundary.ts/localityExtraction.ts:
// this is a courtesy cap on a free public service, not a throughput target,
// so it's deliberately not allowed to adapt upward regardless of how clean
// the run looks.
const CONTAINMENT_CONCURRENCY = 2;
const containmentGate = new AdaptiveConcurrencyGate({
  floor: CONTAINMENT_CONCURRENCY,
  ceiling: CONTAINMENT_CONCURRENCY,
  initial: CONTAINMENT_CONCURRENCY,
});

/**
 * The threshold the review pool is filtered to by default — "list our
 * above 70 relevance" per the user's explicit quality-over-volume request.
 * Candidates below this are still written to the review-candidates file
 * (never silently dropped from disk), just not surfaced as part of the
 * main reviewable list, and never analyzed by Stage B unless the user
 * explicitly un-excludes... there is no UI path to *raise* a sub-70
 * candidate back above the line short of re-running discovery with a
 * different query — this is intentionally a quality floor, not a soft
 * suggestion.
 */
export const REVIEW_SCORE_THRESHOLD = 70;


/** Wraps buildPaperMetadata with the shared enrichmentGate's success/throttle reporting — both Phase A and citation-expansion Phase B candidates funnel through this so the gate sees one consistent signal stream regardless of which phase is currently running. */
async function enrichWithAdaptiveGate(candidates: PaperCandidate[]): Promise<PaperMetadata[]> {
  return mapWithAdaptiveConcurrency(candidates, enrichmentGate, async (candidate) => {
    const metadata = await buildPaperMetadata(candidate);
    if (consumeRecentThrottleSignal()) enrichmentGate.reportThrottled();
    else enrichmentGate.reportSuccess();
    return metadata;
  });
}

export interface RunPipelineOptions {
  region: string;
  taxonGroup: string;
  runId: string;
  resultsPerQuery?: number;
  /** Minimum preliminary relevance score (0-100) for a Phase-A paper to be used as a citation-expansion seed. */
  expansionRelevanceThreshold?: number;
}

/**
 * Stage A: discovery + enrichment + citation expansion + non-LLM relevance
 * ranking (see preliminaryRelevance.ts) — no full-text fetch, no LLM call.
 * Ends by writing the ranked review pool (raw/runs/<runId>-candidates.json)
 * and parking the run status at "awaiting_review". The pipeline does not
 * proceed past this point on its own; the app calls runAnalysisPhase
 * separately once the user has reviewed/curated the pool and clicked
 * Continue. Splitting it this way means a paper the user removes during
 * review never costs a full-text fetch or an LLM call — the whole point of
 * pausing here instead of just hiding already-analyzed results later.
 */
export async function runDiscoveryPhase(options: RunPipelineOptions): Promise<void> {
  const status = createRunStatusTracker(options.runId, options.region, options.taxonGroup);

  try {
    await status.update("discovery");
    // Resolved in parallel with discovery itself (independent of it) so
    // this doesn't add latency. Two things feed off this for ANY region,
    // not just whichever one this was originally debugged against: (1)
    // ownCountryHint lets the wrong-country detector dynamically exclude
    // the target's own country; (2) regionHierarchyForScoring
    // (buildRegionHierarchy) is built from Nominatim's structured address
    // fields (country/state/county/city — see resolveRegionBoundary.ts),
    // not just whatever string the user typed, so district/state/country
    // tokens get matched correctly regardless of how completely the user
    // phrased their search. Both degrade gracefully to the raw input if
    // boundary resolution fails or returns no structured address.
    const [discovery, boundary] = await Promise.all([
      runMultiSourceDiscovery(options.taxonGroup, options.region, options.resultsPerQuery ?? 10),
      resolveRegionBoundary(options.region),
    ]);
    const ownCountryHint = boundary.address?.country;
    const regionHierarchyForScoring = buildRegionHierarchy(boundary, options.region);
    // Multi-source, fault-isolated: Scholar (best-effort supplement) +
    // curated Google CSE web search (new primary) + Crossref + OpenAlex —
    // see multiSourceDiscovery.ts. A single source failing (e.g. Scholar's
    // 429s) no longer aborts the run; it just contributes zero candidates.
    if (discovery.scholarQueries.length > 0) {
      await writeScholarSearchRaw(discovery.scholarQueries, discovery.rawScholarResults);
    }
    await status.setSourceOutcomes(discovery.sourceOutcomes);
    const phaseACandidates: PaperCandidate[] = discovery.candidates;
    await status.update("enrichment", { papersDiscovered: phaseACandidates.length });

    const metadataBySlug = new Map<string, PaperMetadata>();
    const phaseAMetadata = await enrichWithAdaptiveGate(phaseACandidates);
    for (const metadata of phaseAMetadata) metadataBySlug.set(metadata.slug, metadata);

    // Citation-graph expansion (Phase B), gated by the same preliminary
    // relevance scorer used for the final ranking below — a citation seed
    // has to already look region+taxon+citability relevant before its
    // references are worth following.
    await status.update("citation_expansion");
    const threshold = options.expansionRelevanceThreshold ?? 60;
    const seedChecks = phaseAMetadata
      .filter((metadata) => Boolean(metadata.doi))
      .filter(
        (metadata) => scorePreliminaryRelevance(metadata, regionHierarchyForScoring, options.taxonGroup, ownCountryHint).score >= threshold,
      )
      .map((metadata): ExpansionSeed => ({ slug: metadata.slug, doi: metadata.doi! }));

    const expandedCandidates = await expandViaCitations(seedChecks, new Set(metadataBySlug.keys()));
    const phaseBMetadata = await enrichWithAdaptiveGate(expandedCandidates);
    for (const metadata of phaseBMetadata) metadataBySlug.set(metadata.slug, metadata);

    // Rank every surviving candidate (Phase A + Phase B) by the combined
    // region/taxon/citability score — this is the "quality over volume"
    // pass: a keyword-matched encyclopedia entry or an off-region paper
    // never gets analyzed, regardless of how the volume-oriented discovery
    // sources scored it.
    const allMetadata = [...metadataBySlug.values()];
    await status.update("ranking", { papersDiscovered: allMetadata.length });
    const reviewCandidates: ReviewCandidate[] = allMetadata.map((metadata) => {
      const relevance = scorePreliminaryRelevance(metadata, regionHierarchyForScoring, options.taxonGroup, ownCountryHint);
      return {
        metadata,
        score: relevance.score,
        regionScore: relevance.regionScore,
        taxonScore: relevance.taxonScore,
        documentType: relevance.documentType,
        citable: relevance.citable,
        greySignalCredible: relevance.greySignalCredible,
        speciesRecordScore: relevance.speciesRecordScore,
        accessibilityScore: relevance.accessibilityScore,
        excluded: false,
      };
    });
    reviewCandidates.sort((a, b) => b.score - a.score);
    await writeReviewCandidates(options.runId, reviewCandidates);

    const aboveThreshold = reviewCandidates.filter((c) => c.score >= REVIEW_SCORE_THRESHOLD).length;
    await status.update("awaiting_review", {
      papersDiscovered: reviewCandidates.length,
      papersAboveThreshold: aboveThreshold,
      papersBelowThreshold: reviewCandidates.length - aboveThreshold,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await status.fail(describeFailure(message));
    throw err;
  }
}

/**
 * Stage B: resumes a run that's sitting at "awaiting_review", using
 * whichever candidates the user did NOT exclude during review (and which
 * cleared REVIEW_SCORE_THRESHOLD in the first place) — resolves full text,
 * runs LLM species extraction, then containment/catalog/wiki/outputs, same
 * as the old single-pass pipeline's second half. Reports incremental
 * progress (papersRead/totalToAnalyze, speciesFound-so-far) into the run
 * status as it goes, rather than one jump from "started" to "done" — the
 * user explicitly asked to see "how many literature we have read, species
 * list getting updated" while this runs.
 */
export async function runAnalysisPhase(runId: string): Promise<void> {
  const status = await loadRunStatusTracker(runId);
  const { region, taxonGroup } = status.current;

  try {
    const candidates = await readReviewCandidates(runId);
    const survivors = candidates.filter((c) => !c.excluded && c.score >= REVIEW_SCORE_THRESHOLD);
    const allMetadata = survivors.map((c) => c.metadata);

    // Needed per-paper below (coordinate extraction's regionBbox) inside
    // the same loop as full-text resolution + species extraction — moved
    // ahead of the `ecology` step, which still only computes the narrative
    // text itself (not needed until later).
    const boundary = await resolveRegionBoundary(region);

    // Single concurrent per-paper pipeline — replaces what used to be THREE
    // full sequential passes over allMetadata (full-text+extract at
    // FULLTEXT_CONCURRENCY=3, then a fully serial GBIF-enrichment for-loop,
    // then a containment-check pass at CONTAINMENT_CONCURRENCY=2). None of
    // those three steps for one paper actually depend on any OTHER paper's
    // result, only on that same paper's own prior step, so doing all three
    // inside one task per paper removes two whole extra passes' worth of
    // wall-clock time for free. The Nominatim-touching containment call
    // still goes through its own separate, fixed, low-concurrency gate
    // (politeness cap, not a throughput target) so the outer adaptive gate
    // can grow past 2 without ever sending more than 2 concurrent requests
    // to that free geocoder. Status phases below still report the exact
    // same names/fields the UI already expects (see DeepSearchDialog.tsx's
    // PHASE_TO_STEP) — "gbif_enrichment" and "catalog" now report work
    // that's already done (folded into this same loop) rather than work
    // about to start, so they advance near-instantly instead of running as
    // their own slow passes — that's the actual speedup, not a UI change.
    await status.update("fulltext", { totalToAnalyze: allMetadata.length, papersRead: 0, speciesFound: 0 });

    let fullTextDone = 0;
    const speciesFoundSoFar = new Set<string>();
    let droppedContainment = 0;

    await mapWithAdaptiveConcurrency(allMetadata, fullTextGate, async (metadata) => {
      const fullTextStatus = await resolveFullText({
        slug: metadata.slug,
        title: metadata.title,
        doi: metadata.doi,
        url: metadata.url,
      });

      const text = (await readExtractedText(metadata.slug)) ?? metadata.abstract;

      const extraction = await analyzePaper({ metadata, fullText: text, region, taxonGroup, regionBbox: boundary.bbox });
      for (const sp of extraction.species ?? []) speciesFoundSoFar.add(sp.scientificName);

      if (extraction.species && extraction.species.length > 0) {
        extraction.species = enrichSpeciesWithBackbone(extraction.species, taxonGroup);
        await writeLlmAnalysisSnapshot(metadata.slug, extraction);
      }

      // GIS-grounded containment check, after full text exists — the real
      // fix for "too many literature files": a paper whose actual study
      // area is broader than (or unrelated to) the target region is
      // hard-dropped here, never written to catalog. Only runs against
      // real extracted full text (fullTextStatus === "extracted");
      // abstract-only papers are kept with an "unverified" flag per the
      // weaker-evidence decision — not disqualifying, just less certain.
      await containmentGate.acquire();
      let containment: Awaited<ReturnType<typeof checkRegionContainment>> | { verdict: "unverified"; reason: string };
      try {
        containment =
          fullTextStatus === "extracted" && text?.trim()
            ? await checkRegionContainment({ text, targetRegionName: region, targetBoundary: boundary })
            : { verdict: "unverified" as const, reason: "No extracted full text available — containment check skipped." };
      } finally {
        containmentGate.release();
      }

      if (containment.verdict === "broader" || containment.verdict === "unrelated") {
        droppedContainment += 1;
      } else {
        await updateCatalogEntry({
          metadata,
          analysis: extraction,
          fullTextStatus,
          region,
          taxonGroup,
          regionContainment: containment.verdict,
        });
      }

      if (consumeRecentThrottleSignal()) fullTextGate.reportThrottled();
      else fullTextGate.reportSuccess();

      fullTextDone += 1;
      await status.update("fulltext", { papersRead: fullTextDone, speciesFound: speciesFoundSoFar.size });
    });

    // Only the narrative TEXT generation is removed from this workflow, per
    // the user's explicit request to drop the "Ecological Characteristics"
    // section entirely (UI + backend) — the profile itself is still used by
    // the deterministic final review pass just below
    // (checkEcologicalPlausibility). Reported AFTER the merged per-paper
    // pass, not before: an earlier version of this function reported
    // "ecology" ahead of "fulltext", which sent step 2 ("Analyzing Species")
    // to the UI before step 1 ("Extracting Species List") and made the
    // stepper visibly jump backward once fulltext's own status.update calls
    // resumed — phase order sent to the UI must stay monotonic.
    await status.update("ecology");
    const ecologicalProfile = intersectRegion(region, boundary);

    await status.update("gbif_enrichment", { totalToAnalyze: allMetadata.length, papersRead: allMetadata.length });
    await status.update("catalog", { droppedRegionContainment: droppedContainment });

    // "Finalizing", part 1: flags anything that looks wrong across the
    // whole run's assembled species + document list — see
    // analysis/finalReviewPass.ts. No LLM call (deterministic, reuses
    // region/taxon relevance + GBIF-backbone classification already
    // computed earlier in the pipeline), so this runs instantly. Advisory
    // only, never removes anything.
    await status.update("review");
    const wikiEntries = await queryCatalog({ region, taxa: [taxonGroup] });
    const reviewEntries = await Promise.all(
      wikiEntries.map(async (entry) => ({
        entry,
        species: (await readLatestLlmAnalysis<LlmAnalysis>(entry.slug))?.species ?? [],
      })),
    );
    const { speciesFlags, documentFlags } = runFinalReviewPass({ entries: reviewEntries, region, taxonGroup, ecologicalProfile });
    await applyReviewFlags(speciesFlags, documentFlags);
    await status.update("review", { flaggedSpecies: speciesFlags.length, flaggedDocuments: documentFlags.length });

    await status.update("wiki");
    await buildWiki({ region, taxonGroup, entries: wikiEntries });

    await status.update("outputs");
    await buildOutputs();

    await status.update("done", { totalPapers: (await listPaperSlugs()).length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await status.fail(describeFailure(message));
    throw err;
  }
}

/**
 * Adds actionable guidance for known failure modes rather than surfacing a
 * raw error string to the dialog. Google's Scholar block in particular is
 * not transient on retry — it's a temporary network/IP-level rate limit,
 * so the only real remedies are waiting and/or raising
 * SCHOLAR_REQUEST_DELAY_MS, not retrying immediately.
 */
function describeFailure(message: string): string {
  if (message.includes("blocked or challenged")) {
    return (
      `Google Scholar temporarily blocked requests from this network — this happens after a burst of ` +
      `searches in a short time. Wait a while before trying again, and consider raising ` +
      `SCHOLAR_REQUEST_DELAY_MS in research-pipeline/.env (try 1500-2000ms). Retrying immediately will likely ` +
      `fail the same way. (${message})`
    );
  }
  return message;
}
