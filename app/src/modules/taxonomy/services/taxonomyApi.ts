// GBIF-only taxonomy lookups for V1. See implementation plan section 4.
const GBIF_API = "https://api.gbif.org/v1";

export interface GbifMatchResult {
  usageKey: number;
  scientificName: string;
  canonicalName?: string;
  status: "ACCEPTED" | "SYNONYM" | "DOUBTFUL" | string;
  acceptedUsageKey?: number;
  rank: string;
  confidence: number;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
}

export interface GbifSuggestResult {
  key: number;
  scientificName: string;
  canonicalName?: string;
  rank: string;
  status?: string;
}

/** Match an imported scientific name against the GBIF backbone. */
export async function matchSpeciesName(scientificName: string): Promise<GbifMatchResult> {
  const url = new URL(`${GBIF_API}/species/match`);
  url.searchParams.set("name", scientificName);
  url.searchParams.set("strict", "false");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GBIF species/match failed: ${response.status}`);
  }
  return response.json();
}

/** Autocomplete suggestions, used for manual species add / merge-to-existing. */
export async function suggestSpeciesNames(query: string): Promise<GbifSuggestResult[]> {
  const url = new URL(`${GBIF_API}/species/suggest`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GBIF species/suggest failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Occurrence count for a resolved GBIF taxon key, used for evidence/occurrence
 * stats. Pass `gadmGid` to scope the count to a region (matching the gadmGid
 * filter used elsewhere for occurrence search) instead of the whole world.
 */
export async function getOccurrenceCount(taxonKey: number, gadmGid?: string): Promise<number> {
  const url = new URL(`${GBIF_API}/occurrence/count`);
  url.searchParams.set("taxonKey", String(taxonKey));
  if (gadmGid) url.searchParams.set("gadmGid", gadmGid);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GBIF occurrence/count failed: ${response.status}`);
  }
  return response.json();
}

export interface GbifTaxon {
  key: number;
  scientificName: string;
  canonicalName?: string;
  rank: string;
  numDescendants?: number;
}

/**
 * Children of a taxon in the GBIF backbone (e.g. Phyla under a Kingdom,
 * Orders under a Class). Used by the taxonomic scope chain selector so
 * each level only shows children of the parent selected above it.
 */
export async function getChildTaxa(parentKey: number, limit = 50): Promise<GbifTaxon[]> {
  const url = new URL(`${GBIF_API}/species/${parentKey}/children`);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GBIF species/children failed: ${response.status}`);
  }
  const data = await response.json();
  return (data.results ?? []) as GbifTaxon[];
}

/**
 * Resolve a higher-rank name to its GBIF backbone key — the iNaturalist →
 * GBIF bridge.
 *
 * When a scope passes through a rank GBIF doesn't carry (superfamily, tribe,
 * subgenus…), the levels below it are browsed on iNat and so arrive without a
 * GBIF key. The import path needs one, so the picked taxon is matched back by
 * name at a known rank. Constraining `rank` matters: unqualified matching
 * happily returns a genus for a family name.
 *
 * Returns null rather than throwing when GBIF has no confident match, since
 * plenty of iNat taxa legitimately have no GBIF counterpart.
 */
export async function matchTaxonAtRank(name: string, rank: string): Promise<GbifMatchResult | null> {
  const url = new URL(`${GBIF_API}/species/match`);
  url.searchParams.set("name", name);
  url.searchParams.set("rank", rank.toUpperCase());
  url.searchParams.set("strict", "false");

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const match = (await response.json()) as GbifMatchResult & { matchType?: string };
  // A rank GBIF's backbone lacks doesn't come back as a failure — it answers
  // HIGHERRANK with whatever ancestor it could reach (family Hedylidae
  // resolves to kingdom Animalia, usageKey 1, at confidence 95). Checking the
  // returned rank is the only thing that catches it.
  if (!match.usageKey || match.matchType === "NONE" || match.matchType === "HIGHERRANK") return null;
  if (match.rank?.toUpperCase() !== rank.toUpperCase()) return null;
  return match;
}

/**
 * Match a name against the GBIF backbone, returning both the currently
 * accepted usage and the originally matched (possibly synonymous) usage.
 * Historical checklists/occurrence data may be filed under the old
 * (legacy) taxon key, so callers should query evidence sources using
 * BOTH keys to avoid missing records under outdated taxonomy.
 */
export async function matchSpeciesNameWithHistory(scientificName: string): Promise<{
  match: GbifMatchResult;
  currentTaxonKey: number;
  legacyTaxonKey: number | null;
}> {
  const match = await matchSpeciesName(scientificName);
  const currentTaxonKey = match.acceptedUsageKey ?? match.usageKey;
  const legacyTaxonKey =
    match.status === "SYNONYM" && match.usageKey !== currentTaxonKey ? match.usageKey : null;

  return { match, currentTaxonKey, legacyTaxonKey };
}
