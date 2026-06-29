import { ScholarClient } from "../mcp/scholarClient.js";
import { paperSlug } from "../corpus/paperSlug.js";
import type { PaperCandidate, ScholarSearchResult } from "../types.js";

/** Same 4-query-template pattern as the existing app's literature/search.ts, reused here against Scholar. */
export function buildQueryTemplates(taxonGroup: string, regionName: string): string[] {
  return [
    `${taxonGroup} checklist ${regionName}`,
    `${taxonGroup} survey fauna ${regionName}`,
    `${taxonGroup} species diversity ${regionName}`,
    `new record ${taxonGroup} ${regionName}`,
  ];
}

function toCandidate(result: ScholarSearchResult): PaperCandidate {
  return {
    slug: paperSlug({ title: result.Title }),
    title: result.Title,
    authorsLine: result.Authors,
    year: result.Year,
    url: result.URL,
    discoveredVia: "scholar_search",
    scholar: result,
  };
}

function dedupe(candidates: PaperCandidate[]): PaperCandidate[] {
  const seen = new Map<string, PaperCandidate>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.slug)) seen.set(candidate.slug, candidate);
  }
  return [...seen.values()];
}

/**
 * Phase A discovery: runs the query templates against ScholarMCP,
 * sequentially (the server already paces itself via
 * SCHOLAR_REQUEST_DELAY_MS, no need to fan out concurrently and fight that
 * pacing), and returns deduped candidates. `maxResultsPerQuery` can exceed
 * ScholarMCP's own 20-per-call cap — pagination via `start`/`nextPageStart`
 * fetches additional pages until the cap is reached or Scholar runs out of
 * results, so a user asking for "more than 10 or 20" results per query
 * doesn't need a second mechanism.
 */
export async function searchScholar(
  client: ScholarClient,
  taxonGroup: string,
  regionName: string,
  maxResultsPerQuery = 10,
): Promise<{ queries: string[]; rawResults: ScholarSearchResult[]; candidates: PaperCandidate[] }> {
  const queries = buildQueryTemplates(taxonGroup, regionName);
  const rawResults: ScholarSearchResult[] = [];

  for (const query of queries) {
    let start = 0;
    let collected = 0;
    while (collected < maxResultsPerQuery) {
      const pageSize = Math.min(20, maxResultsPerQuery - collected);
      const { results, nextPageStart } = await client.searchKeywordsPage(query, pageSize, start);
      rawResults.push(...results);
      collected += results.length;
      if (results.length === 0 || nextPageStart === undefined || nextPageStart <= start) break;
      start = nextPageStart;
    }
  }

  const candidates = dedupe(rawResults.map(toCandidate));
  return { queries, rawResults, candidates };
}
