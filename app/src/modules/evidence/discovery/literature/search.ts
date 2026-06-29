import { searchOpenAlex } from "./sources/openAlex";
import { searchCrossref } from "./sources/crossref";
import { searchSemanticScholar } from "./sources/semanticScholar";
import { searchBhl } from "./sources/bhl";
import type { LiteratureDocument } from "./types";

const PER_SOURCE_LIMIT = 25;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — literature doesn't change minute to minute.

const cache = new Map<string, { expiresAt: number; data: LiteratureDocument[] }>();

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupe(docs: LiteratureDocument[]): LiteratureDocument[] {
  const seen = new Set<string>();
  const result: LiteratureDocument[] = [];
  for (const doc of docs) {
    const key = doc.doi ? `doi:${doc.doi.toLowerCase()}` : `title:${normalizeTitle(doc.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
  }
  return result;
}

/**
 * Searches OpenAlex, Crossref, Semantic Scholar, and (if configured) BHL for
 * regional checklist/survey publications matching the taxon group + region,
 * runs all sources in parallel with per-source error isolation, dedupes, and
 * caches the merged result for an hour.
 */
export async function searchLiterature(taxonGroup: string, regionName: string): Promise<LiteratureDocument[]> {
  const cacheKey = `${taxonGroup.toLowerCase()}|${regionName.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const queries = [
    `${taxonGroup} checklist ${regionName}`,
    `${taxonGroup} survey fauna ${regionName}`,
    `${taxonGroup} species diversity ${regionName}`,
    `new record ${taxonGroup} ${regionName}`,
  ];

  const perQuery = await Promise.all(
    queries.map(async (query) => {
      const [openalex, crossref, semanticscholar, bhl] = await Promise.all([
        searchOpenAlex(query, PER_SOURCE_LIMIT),
        searchCrossref(query, PER_SOURCE_LIMIT),
        searchSemanticScholar(query, PER_SOURCE_LIMIT),
        searchBhl(query, PER_SOURCE_LIMIT),
      ]);
      console.log(
        `[literature] "${query}" -> openalex=${openalex.length} crossref=${crossref.length} semanticscholar=${semanticscholar.length} bhl=${bhl.length}`,
      );
      return [...openalex, ...crossref, ...semanticscholar, ...bhl];
    }),
  );

  const data = dedupe(perQuery.flat());
  console.log(
    `[literature] "${taxonGroup}" / "${regionName}" -> ${perQuery.flat().length} raw, ${data.length} after dedupe`,
  );
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}
