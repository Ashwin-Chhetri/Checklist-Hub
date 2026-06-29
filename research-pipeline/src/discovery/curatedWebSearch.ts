import { searchGoogleCse, type GoogleCseResult } from "../sources/googleCustomSearch.js";
import { buildSiteRestrictionChunks } from "./curatedDomains.js";
import { buildQueryTemplates } from "./scholarSearch.js";
import { withQueryCache } from "./queryCache.js";
import { paperSlug } from "../corpus/paperSlug.js";
import type { PaperCandidate } from "../types.js";

// Only the first 2 of the 4 Scholar query templates ("checklist" and
// "survey fauna" variants) — Google CSE's free tier is a hard 100/day cap
// with no recovery until reset (unlike Scholar's temporary block), so this
// source intentionally uses fewer, more targeted queries. The
// domain-restriction itself already narrows results far more than an
// unrestricted query would, so fewer phrasings are needed for good recall.
const TEMPLATE_COUNT = 2;

function toCandidate(result: GoogleCseResult): PaperCandidate {
  return {
    slug: paperSlug({ title: result.title }),
    title: result.title,
    url: result.link,
    discoveredVia: "curated_web_search",
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
 * Curated-domain discovery: restricts each query to CURATED_DOMAINS via
 * site: OR-clauses, caches every raw query result on disk for a week (see
 * queryCache.ts) so repeated test runs for the same region+taxon don't
 * burn the daily quota, and never throws — an unconfigured or failing
 * Google CSE call just yields zero candidates from this source (isolated
 * by the caller, multiSourceDiscovery.ts).
 */
export async function searchCuratedWeb(
  taxonGroup: string,
  regionName: string,
  resultsPerQuery = 10,
): Promise<{ queries: string[]; candidates: PaperCandidate[] }> {
  const baseTemplates = buildQueryTemplates(taxonGroup, regionName).slice(0, TEMPLATE_COUNT);
  const siteChunks = buildSiteRestrictionChunks();
  const queries = baseTemplates.flatMap((template) => siteChunks.map((chunk) => `${template} ${chunk}`));

  const allResults: GoogleCseResult[] = [];
  for (const query of queries) {
    const response = await withQueryCache(query, () => searchGoogleCse(query, Math.min(resultsPerQuery, 10)));
    allResults.push(...response.results);
  }

  const candidates = dedupe(allResults.map(toCandidate));
  return { queries, candidates };
}
