import { listCatalogEntries } from "./catalogBuilder.js";
import type { CatalogEntry, DocumentType } from "../types.js";

export interface CatalogQuery {
  region?: string;
  taxa?: string[];
  historical?: boolean;
  hasCoordinates?: boolean;
  minRelevance?: number;
  documentType?: DocumentType;
  regionContainment?: CatalogEntry["regionContainment"];
  /** Defaults to false: user-excluded documents (see CatalogEntry.excluded) are skipped unless explicitly requested. */
  includeExcluded?: boolean;
}

function matchesRegion(entry: CatalogEntry, region: string): boolean {
  const needle = region.toLowerCase();
  return entry.region.some((r) => r.toLowerCase().includes(needle) || needle.includes(r.toLowerCase()));
}

/**
 * In-memory filtering over catalog/*.json — answers questions like "all
 * historical avifaunal checklists from Eastern Himalaya with coordinates"
 * by scanning small flat JSON records, never raw PDFs/text. Moves to a
 * local SQLite table later if the corpus grows large enough that flat-file
 * scanning becomes slow — not needed at this scale (see plan).
 */
export async function queryCatalog(query: CatalogQuery): Promise<CatalogEntry[]> {
  const entries = await listCatalogEntries();
  return entries.filter((entry) => {
    if (entry.excluded && !query.includeExcluded) return false;
    if (query.region && !matchesRegion(entry, query.region)) return false;
    if (query.taxa && query.taxa.length > 0) {
      const entryTaxaLower = entry.taxa.map((t) => t.toLowerCase());
      if (!query.taxa.some((t) => entryTaxaLower.includes(t.toLowerCase()))) return false;
    }
    if (query.historical !== undefined && entry.historical !== query.historical) return false;
    if (query.hasCoordinates !== undefined && entry.has_coordinates !== query.hasCoordinates) return false;
    if (query.minRelevance !== undefined && (entry.llm_relevance ?? 0) < query.minRelevance) return false;
    if (query.documentType !== undefined && entry.documentType !== query.documentType) return false;
    if (query.regionContainment !== undefined && entry.regionContainment !== query.regionContainment) return false;
    return true;
  });
}
