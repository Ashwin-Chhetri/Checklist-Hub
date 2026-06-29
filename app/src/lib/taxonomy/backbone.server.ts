/**
 * Server-only: thin HTTP client for the GBIF backbone mirror, which lives on
 * the standalone reference-data-service (DigitalOcean) rather than this
 * process — Vercel's serverless filesystem can't hold the ~2.5GB SQLite
 * file. The actual lookup logic (spelling-variant fallback, vernacular-name
 * fuzzy matching, elevated-subspecies resolution) is ported verbatim into
 * reference-data-service/src/backbone.js; keep the two in sync if it changes.
 *
 * Shared between /api/taxonomy/normalize (batch UI endpoint) and
 * /api/checklists (used to normalize CSV-uploaded species at creation time
 * so synonym/outdated-name conflicts are flagged before the DB insert).
 */

import { callDataService } from "@/lib/dataService.server";

export interface VernacularNameRow {
  taxon_id: number;
  vernacular_name: string;
  language: string | null;
  country_code: string | null;
  is_preferred: number; // 0 | 1
}

export type NormalizeMatchType = "accepted" | "synonym" | "doubtful" | "none";

export interface BackboneResult {
  taxonKey: number | null;
  scientificName: string | null;
  canonicalName: string | null;
  authorship: string | null;
  rank: string | null;
  matchType: NormalizeMatchType;
  originalStatus: string | null;
  ownTaxonId: number | null;
  ownScientificName: string | null;
  ownAuthorship: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
  ownClassification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
  ownNamePublishedInYear: number | null;
  parentTaxonId: number | null;
  nameAccordingTo: string | null;
  namePublishedIn: string | null;
  namePublishedInYear: number | null;
  matchedViaCommonName?: boolean;
  matchedViaSubspeciesRank?: boolean;
}

const NO_MATCH: BackboneResult = {
  taxonKey: null,
  scientificName: null,
  canonicalName: null,
  authorship: null,
  rank: null,
  matchType: "none",
  originalStatus: null,
  ownTaxonId: null,
  ownScientificName: null,
  ownAuthorship: null,
  classification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null, species: null },
  ownClassification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null, species: null },
  ownNamePublishedInYear: null,
  parentTaxonId: null,
  nameAccordingTo: null,
  namePublishedIn: null,
  namePublishedInYear: null,
};

let loggedUnavailable = false;
function onServiceError(label: string, err: unknown): void {
  // Without this log, the data service being down makes every caller
  // (normalize, subspecies, suggest, species-media, CSV import
  // normalization) silently behave as if no taxon ever matches.
  if (!loggedUnavailable) {
    loggedUnavailable = true;
    console.error(`[backbone] reference-data-service call failed (${label}):`, err);
  }
}

/**
 * Normalize a single name or GBIF key against the backbone.
 * Returns NO_MATCH when the data service is unavailable or no row matched.
 */
export async function lookupBackbone(
  input: { gbifKey?: number; name?: string; commonName?: string },
  kingdomHint?: string,
): Promise<BackboneResult> {
  try {
    return await callDataService<BackboneResult>("/backbone/lookup", {
      method: "POST",
      body: JSON.stringify({ input, kingdomHint }),
    });
  } catch (err) {
    onServiceError("lookupBackbone", err);
    return NO_MATCH;
  }
}

/**
 * Batch version: normalizes many inputs in one request to the data service.
 */
export async function lookupBackboneBatch(
  items: Array<{ id: string; gbifKey?: number; name?: string; commonName?: string }>,
  kingdomHint?: string,
): Promise<Map<string, BackboneResult>> {
  try {
    const out = await callDataService<Record<string, BackboneResult>>("/backbone/lookup-batch", {
      method: "POST",
      body: JSON.stringify({ items, kingdomHint }),
    });
    return new Map(Object.entries(out));
  } catch (err) {
    onServiceError("lookupBackboneBatch", err);
    return new Map(items.map((item) => [item.id, NO_MATCH]));
  }
}

export function normalizeVernacularName(raw: string): string {
  const base = raw.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  return stripQualifiers(base);
}

const LEADING_QUALIFIER_RE =
  /^(eastern|western|northern|southern|common|greater|lesser|rufous|black|white|red|blue|grey|gray|large|small|little|great|long|short|pale|dark|african|asian|indian|american|european|australian|spotted|streaked|striped|variable)\s+/;
const TRAILING_QUALIFIER_RE = /,?\s+(eastern|western|northern|southern|common|greater|lesser)\s*$/;

function stripQualifiers(name: string): string {
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(LEADING_QUALIFIER_RE, "");
  }
  return name.replace(TRAILING_QUALIFIER_RE, "").trim();
}

/**
 * Fuzzy lookup: find a backbone taxon by English common name.
 */
export async function lookupByVernacularName(commonName: string): Promise<BackboneResult | null> {
  try {
    const result = await lookupBackbone({ commonName });
    return result.matchType === "none" && !hasRealHierarchy(result.classification) ? null : result;
  } catch (err) {
    onServiceError("lookupByVernacularName", err);
    return null;
  }
}

function hasRealHierarchy(c: BackboneResult["classification"]): boolean {
  return Boolean(c.kingdom || c.phylum || c.class || c.order || c.family || c.genus || c.species);
}

export interface ExhaustiveLookupCandidates {
  gbifKey?: number;
  names?: (string | undefined | null)[];
  commonNames?: (string | undefined | null)[];
  kingdomHint?: string;
}

/**
 * Last-resort fallback lookup: tries every piece of identifying information
 * available for a row, in priority order (gbifKey, then names, then common
 * names), delegating the actual fallback chain to the data service.
 */
export async function lookupBackboneExhaustive(candidates: ExhaustiveLookupCandidates): Promise<BackboneResult> {
  try {
    return await callDataService<BackboneResult>("/backbone/lookup-exhaustive", {
      method: "POST",
      body: JSON.stringify(candidates),
    });
  } catch (err) {
    onServiceError("lookupBackboneExhaustive", err);
    return NO_MATCH;
  }
}

/**
 * Fetch subspecies, varieties, and forms whose parent is the given taxon.
 */
export async function getSubspecies(
  taxonId: number,
): Promise<Array<{ taxon_id: number; scientific_name: string | null; vernacular_name: string | null }>> {
  try {
    return await callDataService(`/backbone/subspecies?taxonId=${taxonId}`);
  } catch (err) {
    onServiceError("getSubspecies", err);
    return [];
  }
}

/**
 * Fetch all vernacular names for a taxon.
 */
export async function getVernacularNames(taxonId: number): Promise<VernacularNameRow[]> {
  try {
    return await callDataService(`/backbone/vernacular?taxonId=${taxonId}`);
  } catch (err) {
    onServiceError("getVernacularNames", err);
    return [];
  }
}

/**
 * Batched form of `getVernacularNames` — one request for all taxon IDs.
 */
export async function getVernacularNamesBatch(taxonIds: number[]): Promise<Map<number, VernacularNameRow[]>> {
  if (taxonIds.length === 0) return new Map();
  try {
    const out = await callDataService<Record<string, VernacularNameRow[]>>("/backbone/vernacular-batch", {
      method: "POST",
      body: JSON.stringify({ taxonIds }),
    });
    return new Map(Object.entries(out).map(([k, v]) => [Number(k), v]));
  } catch (err) {
    onServiceError("getVernacularNamesBatch", err);
    return new Map();
  }
}

export interface BackboneSuggestion {
  taxonId: number;
  scientificName: string | null;
  canonicalName: string | null;
  authorship: string | null;
  year: number | null;
  rank: string | null;
  taxonomicStatus: string | null;
  commonName: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
}

/**
 * Type-ahead search used by the manual taxonomy edit form.
 */
export async function searchBackbone(query: string, limit = 8): Promise<BackboneSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  try {
    return await callDataService(`/backbone/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`);
  } catch (err) {
    onServiceError("searchBackbone", err);
    return [];
  }
}
