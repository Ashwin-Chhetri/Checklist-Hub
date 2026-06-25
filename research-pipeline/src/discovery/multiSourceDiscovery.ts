import { ScholarClient } from "../mcp/scholarClient.js";
import { searchScholar, buildQueryTemplates } from "./scholarSearch.js";
import { searchCuratedWeb } from "./curatedWebSearch.js";
import { searchCrossrefWorks } from "../sources/crossref.js";
import { searchOpenAlexWorks } from "../sources/openAlex.js";
import { paperSlug } from "../corpus/paperSlug.js";
import type { PaperCandidate, ScholarSearchResult, SourceOutcome } from "../types.js";

function dedupe(candidates: PaperCandidate[]): PaperCandidate[] {
  const seen = new Map<string, PaperCandidate>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.slug)) seen.set(candidate.slug, candidate);
  }
  return [...seen.values()];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface SourceRunResult {
  outcome: SourceOutcome;
  candidates: PaperCandidate[];
}

/**
 * Best-effort Scholar source. THE BUG FIX: previously `runPipeline.ts`
 * called `searchScholar()` directly with no try/catch (only a `finally` to
 * close the client) — any failure, including the real "Google Scholar
 * blocked or challenged this request" 429s this redesign exists to work
 * around, propagated to the outer try/catch and aborted the *entire* run.
 * Isolating it here means a Scholar failure now just means zero Scholar
 * candidates, while curated web search / Crossref / OpenAlex / everything
 * downstream still runs normally.
 */
async function runScholarSource(
  taxonGroup: string,
  regionName: string,
  maxResultsPerQuery: number,
): Promise<SourceRunResult & { rawResults: ScholarSearchResult[]; queries: string[] }> {
  const client = new ScholarClient();
  try {
    await client.connect();
    const { queries, rawResults, candidates } = await searchScholar(client, taxonGroup, regionName, maxResultsPerQuery);
    return {
      outcome: { source: "scholar", status: candidates.length > 0 ? "ok" : "empty", count: candidates.length },
      candidates,
      rawResults,
      queries,
    };
  } catch (err) {
    return {
      outcome: { source: "scholar", status: "error", count: 0, message: errorMessage(err) },
      candidates: [],
      rawResults: [],
      queries: [],
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function runCuratedWebSource(taxonGroup: string, regionName: string, maxResultsPerQuery: number): Promise<SourceRunResult> {
  try {
    const { candidates } = await searchCuratedWeb(taxonGroup, regionName, maxResultsPerQuery);
    return { outcome: { source: "curated_web_search", status: candidates.length > 0 ? "ok" : "empty", count: candidates.length }, candidates };
  } catch (err) {
    return { outcome: { source: "curated_web_search", status: "error", count: 0, message: errorMessage(err) }, candidates: [] };
  }
}

async function runCrossrefSource(taxonGroup: string, regionName: string, maxResultsPerQuery: number): Promise<SourceRunResult> {
  try {
    const templates = buildQueryTemplates(taxonGroup, regionName);
    const results = (await Promise.all(templates.map((q) => searchCrossrefWorks(q, maxResultsPerQuery)))).flat();
    const candidates = dedupe(
      results.map((r) => ({
        slug: paperSlug({ doi: r.doi, title: r.title }),
        title: r.title,
        doi: r.doi,
        year: r.year,
        url: r.url,
        discoveredVia: "crossref_search" as const,
      })),
    );
    return { outcome: { source: "crossref", status: candidates.length > 0 ? "ok" : "empty", count: candidates.length }, candidates };
  } catch (err) {
    return { outcome: { source: "crossref", status: "error", count: 0, message: errorMessage(err) }, candidates: [] };
  }
}

async function runOpenAlexSource(taxonGroup: string, regionName: string, maxResultsPerQuery: number): Promise<SourceRunResult> {
  try {
    const templates = buildQueryTemplates(taxonGroup, regionName);
    const results = (await Promise.all(templates.map((q) => searchOpenAlexWorks(q, maxResultsPerQuery)))).flat();
    const candidates = dedupe(
      results.map((r) => ({
        slug: paperSlug({ doi: r.doi, title: r.title }),
        title: r.title,
        doi: r.doi,
        year: r.year,
        discoveredVia: "openalex_search" as const,
      })),
    );
    return { outcome: { source: "openalex", status: candidates.length > 0 ? "ok" : "empty", count: candidates.length }, candidates };
  } catch (err) {
    return { outcome: { source: "openalex", status: "error", count: 0, message: errorMessage(err) }, candidates: [] };
  }
}

export interface MultiSourceDiscoveryResult {
  candidates: PaperCandidate[];
  sourceOutcomes: SourceOutcome[];
  rawScholarResults: ScholarSearchResult[];
  scholarQueries: string[];
}

/**
 * Phase A discovery, multi-source: Scholar (best-effort supplement) +
 * curated-domain Google CSE search (new primary) + Crossref + OpenAlex
 * (re-promoted from enrichment-only, safe now that
 * analysis/regionSpecificity.ts flags broader-region false positives
 * instead of letting them pollute results undetected). All four run
 * concurrently and are isolated from each other — one failing never
 * affects the others or aborts the run; see runScholarSource's docstring
 * for the specific bug this fixes.
 */
export async function runMultiSourceDiscovery(
  taxonGroup: string,
  regionName: string,
  maxResultsPerQuery: number,
): Promise<MultiSourceDiscoveryResult> {
  const [scholar, curated, crossref, openAlex] = await Promise.all([
    runScholarSource(taxonGroup, regionName, maxResultsPerQuery),
    runCuratedWebSource(taxonGroup, regionName, maxResultsPerQuery),
    runCrossrefSource(taxonGroup, regionName, maxResultsPerQuery),
    runOpenAlexSource(taxonGroup, regionName, maxResultsPerQuery),
  ]);

  const candidates = dedupe([...scholar.candidates, ...curated.candidates, ...crossref.candidates, ...openAlex.candidates]);

  return {
    candidates,
    sourceOutcomes: [scholar.outcome, curated.outcome, crossref.outcome, openAlex.outcome],
    rawScholarResults: scholar.rawResults,
    scholarQueries: scholar.queries,
  };
}
