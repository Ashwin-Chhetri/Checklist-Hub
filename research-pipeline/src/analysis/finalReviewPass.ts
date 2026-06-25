import { checkEcologicalPlausibility } from "./ecologicalPlausibility.js";
import type { CatalogEntry, EcologicalProfile, ExtractedSpeciesRecord } from "../types.js";

export interface FinalReviewEntry {
  entry: CatalogEntry;
  species: ExtractedSpeciesRecord[];
}

export interface SpeciesFlag {
  slug: string;
  scientificName: string;
  reason: string;
}

export interface DocumentFlag {
  slug: string;
  reason: string;
}

export interface FinalReviewResult {
  speciesFlags: SpeciesFlag[];
  documentFlags: DocumentFlag[];
}

// Same threshold this pipeline already uses elsewhere for "off-topic"
// signal (see analysis/regionSpecificity.ts / taxonSpecificity.ts's
// score scale, and the app's route.ts possiblyOffRegion/possiblyWrongTaxon
// checks) — kept in lockstep rather than inventing a new cutoff.
const LOW_RELEVANCE_THRESHOLD = 40;

/**
 * The "Finalizing" step's review pass: flags species/documents that look
 * wrong, advisory only — never causes removal (this pipeline never
 * auto-accepts/auto-rejects a species, see ecologicalPlausibility.ts's doc
 * comment). Deliberately has NO LLM call: this used to be a single LLM
 * pass, but that put real per-call rate-limit latency (NVIDIA's 2.5-20s
 * adaptive spacing) on the "Finalizing" step for every run. Everything here
 * is data already computed earlier in the pipeline without an LLM:
 * - Document flags reuse `region_relevance`/`taxon_relevance`
 *   (regionSpecificity.ts/taxonSpecificity.ts, computed during extraction
 *   — always available, LLM or not).
 * - Species flags reuse `checkEcologicalPlausibility` (a coarse
 *   biome-vs-taxon-classification heuristic) against each species'
 *   GBIF-backbone classification (analysis/gbifEnrichment.ts) and the
 *   region's ecological profile.
 * Runs instantly (no network/LLM call), so it also now works in dev
 * environments with no NVIDIA_API_KEY configured at all, which the old
 * LLM-only version silently skipped.
 */
export function runFinalReviewPass(input: {
  entries: FinalReviewEntry[];
  region: string;
  taxonGroup: string;
  ecologicalProfile: EcologicalProfile;
}): FinalReviewResult {
  const speciesFlags: SpeciesFlag[] = [];
  const documentFlags: DocumentFlag[] = [];

  for (const { entry, species } of input.entries) {
    const regionRelevance = entry.region_relevance ?? 100;
    const taxonRelevance = entry.taxon_relevance ?? 100;
    if (regionRelevance < LOW_RELEVANCE_THRESHOLD || taxonRelevance < LOW_RELEVANCE_THRESHOLD) {
      const reasons: string[] = [];
      if (regionRelevance < LOW_RELEVANCE_THRESHOLD) reasons.push(`doesn't specifically match "${input.region}"`);
      if (taxonRelevance < LOW_RELEVANCE_THRESHOLD) reasons.push(`doesn't appear to be about "${input.taxonGroup}"`);
      documentFlags.push({ slug: entry.slug, reason: `This document ${reasons.join(" and ")}.` });
    }

    for (const sp of species) {
      if (!sp.classification) continue;
      const verdict = checkEcologicalPlausibility(input.taxonGroup, sp.classification, input.ecologicalProfile);
      if (verdict.flag === "implausible") {
        speciesFlags.push({ slug: entry.slug, scientificName: sp.scientificName, reason: verdict.reason });
      }
    }
  }

  return { speciesFlags, documentFlags };
}
