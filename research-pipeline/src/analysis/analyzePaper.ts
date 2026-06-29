import { heuristicChecklistVerdict } from "./checklistDetection.js";
import { heuristicRelevanceVerdict } from "./relevanceScoring.js";
import { extractTabularSpecies, isConfidentTabularExtraction } from "./tabularSpeciesExtraction.js";
import { extractProseSpecies, isConfidentProseExtraction } from "./proseSpeciesExtraction.js";
import { extractSpeciesFromTable } from "./chunkedTableExtraction.js";
import { runBatchedExtraction, type BatchExtractionInput, type BatchExtractionResult } from "./batchExtraction.js";
import { extractCoordinateCandidates, correlateCoordinatesWithSpecies } from "./coordinateExtraction.js";
import { extractLocalityCandidates, geocodeLocality } from "./localityExtraction.js";
import { assessGreyLiteratureCredibility } from "./greyLiteratureSignal.js";
import { writeLlmAnalysisSnapshot, writeRawFile } from "../corpus/rawStore.js";
import { renderSpeciesTableMarkdown } from "../corpus/speciesTableMarkdown.js";
import type { LlmAnalysis, PaperMetadata } from "../types.js";

export interface AnalyzePapersBatchInput {
  papers: Array<{ metadata: PaperMetadata; fullText?: string }>;
  region: string;
  taxonGroup: string;
  regionBbox: [number, number, number, number] | null;
  /**
   * Default false: papers the local (tabular/located-table-regex/prose)
   * cascade can't confidently resolve get an empty species list rather than
   * an LLM extraction call — this pipeline's Stage B no longer calls an
   * LLM for extraction by default (see analysis/gbifEnrichment.ts for what
   * replaced it: GBIF backbone enrichment of whatever the local cascade
   * found). Set true to restore the original LLM-fallback behavior — used
   * by discovery/manualContribution.ts, where a single deliberately-pasted
   * paper warrants spending a real extraction call.
   */
  allowLlmFallback?: boolean;
}

export interface AnalyzePaperInput {
  metadata: PaperMetadata;
  fullText?: string;
  region: string;
  taxonGroup: string;
  regionBbox: [number, number, number, number] | null;
  allowLlmFallback?: boolean;
}

/**
 * Runs the full analysis layer for a whole set of papers at once: a
 * local-first cascade, LLM as an opt-in fallback (off by default — see
 * `allowLlmFallback` above):
 * 1. tabularSpeciesExtraction.ts — literal species tables (checklist-type
 *    documents), free and instant.
 * 2. chunkedTableExtraction.ts — checklist-type documents whose table the
 *    plain regex pass (step 1) wasn't confident about (e.g. malformed by
 *    PDF extraction). Locates the table specifically rather than truncating
 *    the whole document. Its own LLM-chunk fallback is gated by the same
 *    `allowLlmFallback` flag (off by default — regex-only result is used
 *    either way, confident or not).
 * 3. proseSpeciesExtraction.ts — ordinary running text, also free and
 *    instant: regex finds binomial-shaped tokens, the local GBIF backbone
 *    SQLite mirror validates them (no network/LLM call).
 * 4. Only when `allowLlmFallback` is true: whatever none of the above could
 *    confidently handle goes through batchExtraction.ts's one batched LLM
 *    call covering several papers at once. When false (the default), an
 *    unresolved paper simply gets `species: []` — its catalog entry
 *    (citation/metadata) is still created, nothing is fabricated.
 * Coordinate/locality extraction stays per-paper and non-LLM, same as
 * before. Never throws — every step degrades gracefully on its own (see
 * each module). Also persists a per-paper `species_table.md` Markdown
 * rendering of whatever was extracted (corpus/speciesTableMarkdown.ts) —
 * the concrete "PDF -> markup" artifact, built from the already-parsed
 * rows rather than reverse-engineered from flat text.
 */
export async function analyzePapersBatch(input: AnalyzePapersBatchInput): Promise<Map<string, LlmAnalysis>> {
  const results = new Map<string, LlmAnalysis>();
  const allowLlmFallback = input.allowLlmFallback === true;

  const localBySlug = new Map<string, BatchExtractionResult>();
  const remaining: BatchExtractionInput[] = [];
  for (const { metadata, fullText } of input.papers) {
    const text = fullText ?? metadata.abstract ?? "";
    const heuristic = heuristicChecklistVerdict({ title: metadata.title, venue: metadata.venue, abstract: metadata.abstract });

    // Always attempt table extraction, regardless of whether the title
    // matched a checklist phrase — real bug found via a paper titled "Bird
    // diversity of tea plantations in Darjeeling Hills..." (no "checklist
    // of"/"avifauna of"-style phrase at all) whose body still contained a
    // literal 42-species table ("Table S1. Bird species recorded..."):
    // gating table extraction on the title heuristic meant this branch
    // never even ran for it. Finding an actual confident species table is
    // itself the stronger, more direct signal — the title-phrase check
    // stays as the bibliographic documentType classification, not as a
    // gate on whether to look for tabular data at all.
    if (text) {
      const tabular = extractTabularSpecies(text, input.taxonGroup);
      if (isConfidentTabularExtraction(tabular)) {
        const relevance = heuristicRelevanceVerdict(`${metadata.title} ${text}`, input.region, input.taxonGroup);
        localBySlug.set(metadata.slug, {
          slug: metadata.slug,
          documentType: "checklist",
          semanticRanking: relevance.semanticRanking,
          regionRelevance: relevance.regionRelevance,
          taxonRelevance: relevance.taxonRelevance,
          historicalImportance: relevance.historicalImportance,
          species: tabular.species,
        });
        continue;
      }

      const located = await extractSpeciesFromTable(text, input.taxonGroup, { allowLlm: allowLlmFallback });
      if (located && located.species.length > 0) {
        const relevance = heuristicRelevanceVerdict(`${metadata.title} ${text}`, input.region, input.taxonGroup);
        localBySlug.set(metadata.slug, {
          slug: metadata.slug,
          documentType: "checklist",
          semanticRanking: relevance.semanticRanking,
          regionRelevance: relevance.regionRelevance,
          taxonRelevance: relevance.taxonRelevance,
          historicalImportance: relevance.historicalImportance,
          species: located.species,
        });
        continue;
      }
    }

    if (text) {
      const prose = extractProseSpecies(text, input.taxonGroup);
      if (isConfidentProseExtraction(prose)) {
        const relevance = heuristicRelevanceVerdict(`${metadata.title} ${text}`, input.region, input.taxonGroup);
        localBySlug.set(metadata.slug, {
          slug: metadata.slug,
          documentType: heuristic.documentType,
          semanticRanking: relevance.semanticRanking,
          regionRelevance: relevance.regionRelevance,
          taxonRelevance: relevance.taxonRelevance,
          historicalImportance: relevance.historicalImportance,
          species: prose.species,
        });
        continue;
      }
    }

    if (allowLlmFallback) {
      remaining.push({ slug: metadata.slug, title: metadata.title, abstract: metadata.abstract, fullText });
      continue;
    }

    // Local cascade couldn't confidently resolve this paper and the LLM
    // fallback is disabled (the default) — keep the paper with an empty
    // species list rather than fabricating or skipping it. Its catalog
    // entry (citation/metadata) is still created downstream.
    const relevance = heuristicRelevanceVerdict(`${metadata.title} ${text}`, input.region, input.taxonGroup);
    localBySlug.set(metadata.slug, {
      slug: metadata.slug,
      documentType: heuristic.documentType,
      semanticRanking: relevance.semanticRanking,
      regionRelevance: relevance.regionRelevance,
      taxonRelevance: relevance.taxonRelevance,
      historicalImportance: relevance.historicalImportance,
      species: [],
    });
  }

  const llmResults: Map<string, BatchExtractionResult> =
    remaining.length > 0 ? await runBatchedExtraction(remaining, input.region, input.taxonGroup) : new Map();

  for (const { metadata, fullText } of input.papers) {
    const extraction = localBySlug.get(metadata.slug) ?? llmResults.get(metadata.slug);
    if (!extraction) continue;

    const text = fullText ?? metadata.abstract ?? "";
    const coordinateCandidates = text ? extractCoordinateCandidates(text, input.regionBbox) : [];
    const correlated = correlateCoordinatesWithSpecies(coordinateCandidates, extraction.species);

    const localities: LlmAnalysis["localities"] = [];
    if (coordinateCandidates.length === 0) {
      for (const sp of extraction.species.slice(0, 5)) {
        if (!sp.sourceSentence) continue;
        const candidates = extractLocalityCandidates(sp.sourceSentence);
        for (const candidate of candidates.slice(0, 1)) {
          const geocoded = await geocodeLocality(candidate, input.region);
          localities.push({ name: geocoded.name, lat: geocoded.lat, lng: geocoded.lng, species: sp.scientificName });
        }
      }
    }

    const greySignal =
      extraction.documentType === "other"
        ? assessGreyLiteratureCredibility({
            title: metadata.title,
            url: metadata.url,
            venue: metadata.venue,
            year: metadata.year,
            authors: metadata.authors,
          })
        : null;

    const analysis: LlmAnalysis = {
      paperSlug: metadata.slug,
      analyzedAt: new Date().toISOString(),
      semanticRanking: extraction.semanticRanking,
      regionRelevance: extraction.regionRelevance,
      taxonRelevance: extraction.taxonRelevance,
      historicalImportance: extraction.historicalImportance,
      isChecklist: extraction.documentType === "checklist",
      documentType: extraction.documentType,
      greySignalCredible: greySignal?.credible,
      greySignalReasons: greySignal?.reasons,
      species: extraction.species,
      coordinates: correlated,
      localities,
    };

    await writeLlmAnalysisSnapshot(metadata.slug, analysis);
    await writeRawFile(metadata.slug, "species_table.md", renderSpeciesTableMarkdown(metadata.title, extraction.species), {
      refresh: true,
    });
    results.set(metadata.slug, analysis);
  }

  return results;
}

/** Single-paper convenience wrapper, kept for callers (manualContribution.ts) that only ever have one paper to analyze. */
export async function analyzePaper(input: AnalyzePaperInput): Promise<LlmAnalysis> {
  const batch = await analyzePapersBatch({
    papers: [{ metadata: input.metadata, fullText: input.fullText }],
    region: input.region,
    taxonGroup: input.taxonGroup,
    regionBbox: input.regionBbox,
    allowLlmFallback: input.allowLlmFallback,
  });
  const result = batch.get(input.metadata.slug);
  if (!result) throw new Error(`analyzePaper: no result produced for ${input.metadata.slug}`);
  return result;
}
