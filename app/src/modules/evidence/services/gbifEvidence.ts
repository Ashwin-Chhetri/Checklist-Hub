const GBIF_API = "https://api.gbif.org/v1";

export interface GbifOccurrenceSummary {
  totalCount: number;
  /** Records before 2000 — proxy for "historical" coverage. */
  historicalCount: number;
  /** Records from 2000 onwards. */
  currentCount: number;
  latestObservationDate: string | null;
}

async function occurrenceCount(params: Record<string, string>): Promise<number> {
  const url = new URL(`${GBIF_API}/occurrence/count`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`GBIF occurrence/count failed: ${response.status}`);
  return response.json();
}

/**
 * Historical + current occurrence counts for a taxon within a GADM region.
 * Queried using the GBIF taxonKey directly (the caller should pass both the
 * current accepted key and any legacy/synonym key and merge the results, so
 * older records filed under a since-renamed taxon aren't missed).
 */
export async function getHistoricalAndCurrentOccurrences(
  taxonKey: number,
  gadmGid?: string,
): Promise<GbifOccurrenceSummary> {
  const base: Record<string, string> = { taxonKey: String(taxonKey) };
  if (gadmGid) base.gadmGid = gadmGid;

  const currentYear = new Date().getFullYear();
  const [totalCount, historicalCount, currentCount] = await Promise.all([
    occurrenceCount(base),
    occurrenceCount({ ...base, year: `1700,1999` }),
    occurrenceCount({ ...base, year: `2000,${currentYear}` }),
  ]);

  // Latest record date: search sorted, smallest payload (limit=0 has no hits array,
  // so request 1 record purely to read its eventDate).
  let latestObservationDate: string | null = null;
  try {
    const searchUrl = new URL(`${GBIF_API}/occurrence/search`);
    Object.entries(base).forEach(([k, v]) => searchUrl.searchParams.set(k, v));
    searchUrl.searchParams.set("limit", "1");
    searchUrl.searchParams.set("year", `2000,${currentYear}`);
    const response = await fetch(searchUrl.toString());
    if (response.ok) {
      const data = await response.json();
      latestObservationDate = data.results?.[0]?.eventDate ?? null;
    }
  } catch {
    // Non-fatal — leave latestObservationDate as null.
  }

  return { totalCount, historicalCount, currentCount, latestObservationDate };
}

const MIN_PLAUSIBLE_YEAR = 1700;

/**
 * Earliest/latest occurrence year for a taxon within a region, via GBIF's
 * `year` facet — one query for the whole taxon+region rather than one per
 * species, so the historical span (often a century or more, vs. just
 * whatever a default-ordered single-record search happens to return) stays
 * cheap to compute regardless of how many species are in scope.
 */
export async function getYearRangeForTaxon(
  taxonKey: number,
  gadmGid?: string,
): Promise<{ earliest: number; latest: number } | null> {
  const params: Record<string, string> = { taxonKey: String(taxonKey) };
  if (gadmGid) params.gadmGid = gadmGid;

  const currentYear = new Date().getFullYear();
  const counts = await occurrenceFacet("year", params, 350);
  const years = counts
    .map((c) => Number(c.name))
    .filter((y) => Number.isFinite(y) && y >= MIN_PLAUSIBLE_YEAR && y <= currentYear + 1);
  if (years.length === 0) return null;
  return { earliest: Math.min(...years), latest: Math.max(...years) };
}

export interface GbifSpeciesFacetItem {
  speciesKey: number;
  count: number;
}

export interface GbifResolvedSpecies {
  key: number;
  scientificName: string;
  canonicalName?: string;
  family?: string;
  vernacularName?: string;
}

async function occurrenceFacet(
  field: string,
  params: Record<string, string>,
  facetLimit: number,
): Promise<Array<{ name: string; count: number }>> {
  const url = new URL(`${GBIF_API}/occurrence/search`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("facet", field);
  url.searchParams.set("facetLimit", String(facetLimit));
  url.searchParams.set("limit", "0");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`GBIF occurrence/search facet failed: ${response.status}`);
  const data = await response.json();
  // GBIF's returned facet field name is a snake_case rendering of the
  // requested field (e.g. "speciesKey" -> "SPECIES_KEY") that doesn't match a
  // simple toUpperCase(); since we only ever request a single facet, just
  // take the first one.
  const facet = (data.facets ?? [])[0];
  return facet?.counts ?? [];
}

/**
 * Per-species occurrence counts for a higher taxon within a region, via
 * GBIF's speciesKey facet on occurrence/search.
 *
 * `facetLimit` defaults high (100,000) because GBIF's facet only returns the
 * top N distinct `speciesKey`s by count — a low limit (e.g. 300) silently
 * truncates the species list *and* the summed occurrence totals for any
 * region/taxon combination with more distinct species than the limit. GBIF
 * returns however many distinct values actually exist (no error/padding) so
 * a generous limit is safe for smaller result sets too.
 */
export async function getSpeciesFacetForTaxon(
  taxonKey: number,
  gadmGid?: string,
  facetLimit = 100_000,
): Promise<GbifSpeciesFacetItem[]> {
  const params: Record<string, string> = { taxonKey: String(taxonKey) };
  if (gadmGid) params.gadmGid = gadmGid;
  const counts = await occurrenceFacet("speciesKey", params, facetLimit);
  return counts
    .map((c) => ({ speciesKey: Number(c.name), count: c.count }))
    .filter((c) => Number.isFinite(c.speciesKey) && c.speciesKey > 0);
}

const speciesResolutionCache = new Map<number, GbifResolvedSpecies>();

/**
 * Resolves species keys against the local GBIF backbone mirror
 * (app/data/gbif-backbone.sqlite, served via /api/taxonomy/resolve-batch).
 * Returns an empty array on any error so callers can fall back to the GBIF
 * API without failing.
 */
async function resolveSpeciesKeysFromBackbone(speciesKeys: number[]): Promise<GbifResolvedSpecies[]> {
  if (speciesKeys.length === 0) return [];
  try {
    const response = await fetch("/api/taxonomy/resolve-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesKeys }),
    });
    if (!response.ok) return [];
    const { rows } = (await response.json()) as {
      rows: Array<{ taxon_id: number; scientific_name: string | null; canonical_name: string | null; family: string | null; vernacular_name: string | null }>;
    };
    return rows.map((row) => ({
      key: row.taxon_id,
      scientificName: row.scientific_name ?? row.canonical_name ?? String(row.taxon_id),
      canonicalName: row.canonical_name ?? undefined,
      family: row.family ?? undefined,
      vernacularName: row.vernacular_name ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolves a batch of GBIF species keys to scientific name + family. Tries
 * the local backbone lookup DB first, then falls back to /v1/species/{key}
 * for any keys not found there. Resolved entries are cached for the session
 * since GBIF backbone taxonomy is stable.
 */
export async function resolveSpeciesKeys(speciesKeys: number[]): Promise<GbifResolvedSpecies[]> {
  const results: GbifResolvedSpecies[] = [];
  let toFetch = speciesKeys.filter((key) => !speciesResolutionCache.has(key));

  const fromBackbone = await resolveSpeciesKeysFromBackbone(toFetch);
  for (const resolved of fromBackbone) {
    speciesResolutionCache.set(resolved.key, resolved);
  }

  const backboneKeys = new Set(fromBackbone.map((r) => r.key));
  toFetch = toFetch.filter((key) => !backboneKeys.has(key));

  const chunkSize = 20;
  for (let i = 0; i < toFetch.length; i += chunkSize) {
    const chunk = toFetch.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (key) => {
        const response = await fetch(`${GBIF_API}/species/${key}`);
        if (!response.ok) return null;
        const data = await response.json();
        const resolved: GbifResolvedSpecies = {
          key,
          scientificName: data.scientificName ?? data.canonicalName ?? String(key),
          canonicalName: data.canonicalName ?? undefined,
          family: data.family ?? undefined,
          vernacularName: data.vernacularName ?? undefined,
        };
        return resolved;
      }),
    );
    chunkResults.forEach((resolved) => {
      if (resolved) speciesResolutionCache.set(resolved.key, resolved);
    });
  }

  for (const key of speciesKeys) {
    const resolved = speciesResolutionCache.get(key);
    if (resolved) results.push(resolved);
  }
  return results;
}

export interface GbifOccurrencePoint {
  key: number;
  lat: number;
  lng: number;
  datasetName: string | null;
  eventDate: string | null;
}

/**
 * Individual occurrence coordinates for a taxon within a GADM region — used
 * by the workbench Evidence panel's region map to plot real occurrence dots
 * (GBIF is the only source with per-occurrence coordinates available today).
 * `limit` is capped well below GBIF's max page size since this is for a
 * small map, not exhaustive analysis.
 */
export async function getOccurrenceCoordinates(
  taxonKey: number,
  gadmGid?: string,
  limit = 300,
): Promise<GbifOccurrencePoint[]> {
  const params: Record<string, string> = {
    taxonKey: String(taxonKey),
    hasCoordinate: "true",
    limit: String(Math.min(limit, 300)),
  };
  if (gadmGid) params.gadmGid = gadmGid;

  const url = new URL(`${GBIF_API}/occurrence/search`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`GBIF occurrence/search failed: ${response.status}`);
  const data = await response.json();
  const results: Array<Record<string, unknown>> = data.results ?? [];

  return results
    .map((r) => ({
      key: r.key as number,
      lat: r.decimalLatitude as number,
      lng: r.decimalLongitude as number,
      datasetName: (r.datasetName as string) ?? null,
      eventDate: (r.eventDate as string) ?? null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.key));
}

/**
 * Breakdown of occurrence record counts by basisOfRecord (e.g. HUMAN_OBSERVATION,
 * PRESERVED_SPECIMEN) for a single species within an optional region. Used to
 * gauge evidence strength/quality during evidence review.
 */
export async function getBasisOfRecordBreakdown(
  speciesKey: number,
  gadmGid?: string,
): Promise<Record<string, number>> {
  const params: Record<string, string> = { speciesKey: String(speciesKey) };
  if (gadmGid) params.gadmGid = gadmGid;

  const counts = await occurrenceFacet("basisOfRecord", params, 20);
  const breakdown: Record<string, number> = {};
  for (const { name, count } of counts) {
    breakdown[name] = count;
  }
  return breakdown;
}
