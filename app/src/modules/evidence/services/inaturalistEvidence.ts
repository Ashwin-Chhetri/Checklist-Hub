const INAT_API = "https://api.inaturalist.org/v1";

async function getInatObservationDate(
  taxonId: number,
  placeId: number,
  order: "asc" | "desc",
): Promise<string | null> {
  const url = new URL(`${INAT_API}/observations`);
  url.searchParams.set("taxon_id", String(taxonId));
  url.searchParams.set("place_id", String(placeId));
  url.searchParams.set("per_page", "1");
  url.searchParams.set("order", order);
  url.searchParams.set("order_by", "observed_on");
  url.searchParams.set("verifiable", "true");
  url.searchParams.set("captive", "false");
  url.searchParams.set("geo", "true");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iNaturalist observations failed: ${response.status}`);
  }
  const data = await response.json();
  return data.results?.[0]?.observed_on ?? null;
}

/**
 * Earliest/latest observation date for an iNaturalist taxon within a place —
 * two cheap queries (ascending/descending by observed date) for the whole
 * taxon+place, not per species, so the historical span stays fast to compute
 * regardless of how many species are in scope.
 */
export async function getInatYearRange(
  taxonId: number,
  placeId: number,
): Promise<{ earliest: string | null; latest: string | null }> {
  const [earliest, latest] = await Promise.all([
    getInatObservationDate(taxonId, placeId, "asc"),
    getInatObservationDate(taxonId, placeId, "desc"),
  ]);
  return { earliest, latest };
}

export interface InatOccurrencePoint {
  id: number;
  lat: number;
  lng: number;
  observedOn: string | null;
}

/**
 * Individual observation coordinates for a taxon within a place — used by
 * the workbench Evidence panel's region map. Same filters as
 * getInatSpeciesCounts (verifiable, wild, geolocated) so points only ever
 * show observations that would actually count toward that total.
 */
export async function getInatObservationPoints(
  taxonId: number,
  placeId: number,
  perPage = 200,
): Promise<InatOccurrencePoint[]> {
  const url = new URL(`${INAT_API}/observations`);
  url.searchParams.set("taxon_id", String(taxonId));
  url.searchParams.set("place_id", String(placeId));
  url.searchParams.set("per_page", String(Math.min(perPage, 200)));
  url.searchParams.set("verifiable", "true");
  url.searchParams.set("captive", "false");
  url.searchParams.set("geo", "true");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iNaturalist observations failed: ${response.status}`);
  }
  const data = await response.json();
  const results: Array<Record<string, unknown>> = data.results ?? [];

  return results
    .map((r) => {
      const geojson = r.geojson as { coordinates?: [number, number] } | undefined;
      const coords = geojson?.coordinates;
      if (!coords) return null;
      return {
        id: r.id as number,
        lng: coords[0],
        lat: coords[1],
        observedOn: (r.observed_on as string | undefined) ?? null,
      };
    })
    .filter((p): p is InatOccurrencePoint => p !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export interface InatSpeciesCount {
  taxonId: number;
  scientificName: string;
  commonName?: string;
  family?: string;
  count: number;
}

/**
 * Species breakdown for a higher taxon within a place, via iNaturalist's
 * species_counts endpoint. Family is derived from the taxon's ancestors when
 * present, otherwise left undefined ("Unknown" in the UI).
 *
 * placeId is REQUIRED — callers must not pass undefined when a region is set.
 * Filters to verifiable, geolocated, wild observations to reduce regional false positives.
 */
export async function getInatSpeciesCounts(
  taxonId: number,
  placeId: number,
  perPage = 200,
): Promise<InatSpeciesCount[]> {
  const url = new URL(`${INAT_API}/observations/species_counts`);
  url.searchParams.set("taxon_id", String(taxonId));
  url.searchParams.set("place_id", String(placeId));
  url.searchParams.set("per_page", String(perPage));
  // Only count verifiable, wild, geolocated observations — prevents globally-present
  // but regionally-absent species from appearing due to stale/captive/unlocated records.
  url.searchParams.set("verifiable", "true");
  url.searchParams.set("captive", "false");
  url.searchParams.set("geo", "true");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iNaturalist species_counts failed: ${response.status}`);
  }
  const data = await response.json();

  return (data.results ?? []).map((entry: { count: number; taxon: Record<string, unknown> }) => {
    const taxon = entry.taxon ?? {};
    const ancestors = (taxon.ancestors as Array<{ rank?: string; name?: string }> | undefined) ?? [];
    const family = ancestors.find((a) => a.rank === "family")?.name;
    return {
      taxonId: taxon.id as number,
      scientificName: (taxon.name as string) ?? `Taxon ${taxon.id}`,
      commonName: (taxon.preferred_common_name as string | undefined) ?? undefined,
      family,
      count: entry.count ?? 0,
    } satisfies InatSpeciesCount;
  });
}

/**
 * Resolves a scientific name (optionally constrained by rank, e.g. "family")
 * to an iNaturalist taxon id. Returns null if no match is found.
 */
export async function resolveInatTaxonId(scientificName: string, rank?: string): Promise<number | null> {
  const url = new URL(`${INAT_API}/taxa`);
  url.searchParams.set("q", scientificName);
  if (rank) url.searchParams.set("rank", rank);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iNaturalist taxa lookup failed: ${response.status}`);
  }
  const data = await response.json();
  return data.results?.[0]?.id ?? null;
}

interface InatPlaceResult {
  id: number;
  display_name?: string;
  admin_level?: number;
}

/** Runs one places/autocomplete query and picks the best candidate from its results, or null if there's no match. */
async function autocompletePlace(
  query: string,
  regionCountry?: string,
): Promise<InatPlaceResult | null> {
  const url = new URL(`${INAT_API}/places/autocomplete`);
  url.searchParams.set("q", query);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iNaturalist places lookup failed: ${response.status}`);
  }
  const data = await response.json();
  const results: InatPlaceResult[] = data.results ?? [];
  if (results.length === 0) return null;

  // Filter to results that include the country name in their display_name, when
  // possible. iNat's display_name usually abbreviates state/country (e.g. "WB, IN"
  // rather than "West Bengal, India"), so this rarely matches — when it doesn't,
  // fall back to the unfiltered results rather than discarding real candidates.
  const countryLower = regionCountry?.toLowerCase();
  const countryValidated = countryLower
    ? results.filter((r) => r.display_name?.toLowerCase().includes(countryLower))
    : results;
  const candidates = countryValidated.length > 0 ? countryValidated : results;

  // Prefer sub-national places (admin_level 1–9: state/province/county/district).
  // admin_level 0 = country; we never want to fall back to a whole-country place
  // because that would return species from anywhere in the country.
  const subNational = candidates.filter((r) => {
    const lvl = r.admin_level ?? -1;
    return lvl >= 1 && lvl <= 9;
  });
  const pool = subNational.length > 0 ? subNational : candidates;

  // Among candidates, pick the most specific (highest admin_level = smallest area).
  return pool.reduce((a, b) => ((b.admin_level ?? 0) > (a.admin_level ?? 0) ? b : a));
}

/**
 * Resolves a region to an iNaturalist place id via the places autocomplete endpoint.
 *
 * iNat's autocomplete matches against each place's own name/display_name fairly
 * literally — a query joining multiple administrative levels with commas (e.g.
 * "Darjeeling, West Bengal, India") essentially never matches anything, because
 * iNat's display_name abbreviates state/country ("Darjiling, WB, IN") rather than
 * spelling them out, and joined multi-part queries don't fuzzy-match against that
 * format. So this tries progressively simpler/broader queries until one matches:
 *   1. The full "district, state, country" query (works for the rare place whose
 *      display_name happens to match it).
 *   2. The district/region name alone.
 *   3. The state name alone — sub-national, so still useful for filtering, just
 *      coarser than district-level. (Country name alone is intentionally never
 *      tried — that would admit a whole-country place and defeat the point of
 *      region scoping.)
 *
 * Returns null when no place can be resolved at any level. Callers must treat
 * null as "cannot filter by region" and skip the query rather than falling back
 * to global results.
 */
export async function resolveInatPlaceId(
  regionName: string,
  regionState?: string,
  regionCountry?: string,
): Promise<number | null> {
  const queries = [...new Set(
    [
      [regionName, regionState, regionCountry].filter(Boolean).join(", "),
      regionName,
      regionState,
    ].filter((q): q is string => Boolean(q?.trim())),
  )];

  for (const query of queries) {
    const best = await autocompletePlace(query, regionCountry);
    if (best) return best.id;
  }
  return null;
}
