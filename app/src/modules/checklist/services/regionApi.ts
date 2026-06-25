// Region address resolution: free-text -> address breakdown via Nominatim
// (OpenStreetMap) reverse/forward geocoding. No GADM lookup — just gives the
// user a clear sub-district / district / state / country / pin breakdown of
// whatever they typed.
const NOMINATIM_API = "https://nominatim.openstreetmap.org";

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// app on every request (no generic browser-like UA) — see
// https://operations.osmfoundation.org/policies/nominatim/.
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "checklist-hub/1.0 (biodiversity checklist region lookup)",
};

export interface ResolvedRegion {
  /** The administrative level that best matches what the user typed. */
  matchedLevel: "sub_district" | "district" | "state" | "country" | "place";
  matchedName: string;
  subDistrict: string;
  district: string;
  state: string;
  country: string;
  pin: string;
  /** Centroid coordinates, when Nominatim returned them — used as a fallback postal-code lookup. */
  lat: string | null;
  lon: string | null;
  /** OSM element type/id for the matched place — used to fetch its boundary
   * polygon directly from Nominatim when no district-level GADM geometry
   * exists for this region (see fetchRegionBoundary). */
  osmType: "node" | "way" | "relation" | null;
  osmId: string | null;
  /** [south, north, west, east], when Nominatim returned one — last-resort
   * approximate boundary when neither GADM nor an OSM polygon is available. */
  boundingBox: [string, string, string, string] | null;
}

export interface RegionSuggestion extends ResolvedRegion {
  /** Full label for the suggestion dropdown, e.g. "Darjeeling, West Bengal, India". */
  displayName: string;
}

interface NominatimAddress {
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  hamlet?: string;
  town?: string;
  village?: string;
  city?: string;
  municipality?: string;
  borough?: string;
  city_district?: string;
  district?: string;
  county?: string;
  state_district?: string;
  state?: string;
  province?: string;
  region?: string;
  country?: string;
  postcode?: string;
}

interface NominatimResult {
  display_name: string;
  address?: NominatimAddress;
  lat?: string;
  lon?: string;
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  boundingbox?: [string, string, string, string];
}

function buildResolvedRegion(result: NominatimResult, query: string): ResolvedRegion {
  const address = result.address ?? {};

  const subDistrict = address.suburb || address.neighbourhood || address.quarter || address.hamlet || address.city_district || "";
  // Many countries outside India have no separate "district" admin tier in
  // Nominatim's address breakdown — their most specific subdivision below
  // state level is just a city/town/municipality/borough (e.g. Toronto,
  // Cape Town). Falling back to that here means `district` (and everything
  // downstream that reads it — the GADM lookup, the dropdown chips, the
  // locked-in selection) still gets a meaningful value for those regions
  // instead of coming back empty.
  const district =
    address.state_district ||
    address.county ||
    address.district ||
    address.city ||
    address.municipality ||
    address.town ||
    address.borough ||
    "";
  const state = address.state || address.province || address.region || "";
  const country = address.country || "";
  const pin = address.postcode || "";
  const place = address.city || address.town || address.village || result.display_name.split(",")[0]?.trim() || "";

  // Figure out which level the user's query actually matched, so the UI can
  // highlight that field. Checked from least to most specific so the most
  // specific applicable match always wins, regardless of which fields a
  // given country's address breakdown happens to populate (a literal
  // country-name substring match shouldn't beat a more specific place/district
  // match just because it's checked first).
  const lowerQuery = query.trim().toLowerCase();
  let matchedLevel: ResolvedRegion["matchedLevel"] = "place";
  let matchedName = place || country || query.trim();
  if (country && lowerQuery.includes(country.toLowerCase())) {
    matchedLevel = "country";
    matchedName = country;
  }
  if (state && lowerQuery.includes(state.toLowerCase())) {
    matchedLevel = "state";
    matchedName = state;
  }
  if (district && lowerQuery.includes(district.toLowerCase())) {
    matchedLevel = "district";
    matchedName = district;
  }
  if (place && lowerQuery.includes(place.toLowerCase())) {
    matchedLevel = "district";
    matchedName = place;
  }
  if (subDistrict && lowerQuery.includes(subDistrict.toLowerCase())) {
    matchedLevel = "sub_district";
    matchedName = subDistrict;
  }

  return {
    matchedLevel,
    matchedName,
    subDistrict,
    district,
    state,
    country,
    pin,
    lat: result.lat ?? null,
    lon: result.lon ?? null,
    osmType: result.osm_type ?? null,
    osmId: result.osm_id != null ? String(result.osm_id) : null,
    boundingBox: result.boundingbox ?? null,
  };
}

async function searchNominatim(query: string, limit: number): Promise<NominatimResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL(`${NOMINATIM_API}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(limit));
  // Without this, country/admin names come back in the place's local
  // language/script (e.g. "日本"/"東京都" for Tokyo) instead of English —
  // unreadable for most users searching from this app.
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url.toString(), { headers: NOMINATIM_HEADERS });
  if (!response.ok) {
    throw new Error(`Nominatim search failed: ${response.status}`);
  }
  return (await response.json()) as NominatimResult[];
}

/**
 * Resolve a free-text region name (e.g. "Darjeeling", "Kalimpong", "West
 * Bengal") to its administrative address breakdown — sub-district, district,
 * state, country and postal code — via Nominatim's forward geocoder with
 * address details.
 */
export async function resolveRegionAddress(query: string): Promise<ResolvedRegion | null> {
  const data = await searchNominatim(query, 1);
  if (data.length === 0) return null;
  return buildResolvedRegion(data[0], query);
}

/**
 * Returns up to `limit` candidate regions matching the free-text query, for
 * display in a suggestion dropdown the user can pick from.
 */
export async function searchRegionSuggestions(query: string, limit = 5): Promise<RegionSuggestion[]> {
  const data = await searchNominatim(query, limit);
  return data.map((result) => ({
    ...buildResolvedRegion(result, query),
    displayName: result.display_name,
  }));
}

/**
 * Best-effort postal/PIN code lookup for a resolved region's centroid.
 *
 * Forward district-level searches (`searchRegionSuggestions`) almost never
 * carry a `postcode` — an admin boundary the size of a district spans many
 * postcodes, so Nominatim only attaches one to point/address-level results.
 * Reverse-geocoding the same centroid at a high zoom level (building/street)
 * resolves to a single point, which Nominatim is much more likely to tag
 * with a representative postcode. Still best-effort — returns null if
 * unavailable, same as resolveGadmId.
 */
export async function resolvePostalCode(lat: string, lon: string): Promise<string | null> {
  const url = new URL(`${NOMINATIM_API}/reverse`);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const response = await fetch(url.toString(), { headers: NOMINATIM_HEADERS });
  if (!response.ok) return null;
  const data = (await response.json()) as NominatimResult;
  return data.address?.postcode || null;
}

/**
 * Resolves a country/state/district name triple to a GADM GID via the local
 * GADM lookup (`/api/regions/gadm-lookup`, built by `npm run build:gadm`).
 * GBIF indexes occurrences against these same GIDs, so a resolved GID lets
 * GBIF queries be scoped to the region via the `gadmGid` parameter. Returns
 * null if no lookup table is available or no match is found.
 */
export async function resolveGadmId(region: {
  country: string;
  state: string;
  district: string;
}): Promise<string | null> {
  const response = await fetch("/api/regions/gadm-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(region),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { gid: string | null };
  return data.gid;
}

/** Minimal local GeoJSON geometry shapes — only what `build-gadm.mjs`/the OSM boundary route ever emit. */
export type BoundaryGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface RegionBoundary {
  geometry: BoundaryGeometry | null;
  name: string | null;
  /** Which tier actually produced this geometry — "bbox" is a rectangular
   * approximation, not a real outline, so callers can render it differently. */
  source: "gadm" | "osm" | "bbox" | null;
}

export interface RegionBoundaryRequest {
  gadmId?: string | null;
  osmType?: string | null;
  osmId?: string | null;
  boundingBox?: [string, string, string, string] | null;
}

/** Builds a rectangular boundary from Nominatim's [south, north, west, east] bbox — the last-resort fallback so the map is never fully empty. */
function bboxToPolygon(boundingBox: [string, string, string, string]): BoundaryGeometry {
  const [south, north, west, east] = boundingBox.map(Number);
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

async function fetchGadmBoundary(gadmId: string): Promise<RegionBoundary | null> {
  const response = await fetch(`/api/regions/gadm-geometry?gid=${encodeURIComponent(gadmId)}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { geometry: BoundaryGeometry | null; name: string | null };
  if (!data.geometry) return null;
  return { geometry: data.geometry, name: data.name, source: "gadm" };
}

async function fetchOsmBoundary(osmType: string, osmId: string): Promise<RegionBoundary | null> {
  const response = await fetch(
    `/api/regions/osm-boundary?osmType=${encodeURIComponent(osmType)}&osmId=${encodeURIComponent(osmId)}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { geometry: BoundaryGeometry | null; name: string | null };
  if (!data.geometry) return null;
  return { geometry: data.geometry, name: data.name, source: "osm" };
}

/**
 * Resolves a region's boundary GeoJSON for the workbench Evidence panel's
 * map, trying each tier in order:
 *  1. GADM's cached district-level geometry (`/api/regions/gadm-geometry`) —
 *     fastest, no external call, but only ever populated when the region
 *     resolved to a level-2 (district) GADM GID.
 *  2. Nominatim's own boundary for the exact OSM place the user selected
 *     (`/api/regions/osm-boundary`) — works at any admin level worldwide,
 *     covers the state/country-level GADM misses (e.g. Sikkim).
 *  3. A rectangular approximation from Nominatim's bounding box — so the
 *     panel is never fully blank even if both real boundary sources fail.
 */
export async function fetchRegionBoundary(request: RegionBoundaryRequest): Promise<RegionBoundary> {
  if (request.gadmId) {
    const gadmBoundary = await fetchGadmBoundary(request.gadmId);
    if (gadmBoundary) return gadmBoundary;
  }

  if (request.osmType && request.osmId) {
    const osmBoundary = await fetchOsmBoundary(request.osmType, request.osmId);
    if (osmBoundary) return osmBoundary;
  }

  if (request.boundingBox) {
    console.warn("[regionApi] No real boundary found — falling back to approximate bounding box.", request);
    return { geometry: bboxToPolygon(request.boundingBox), name: null, source: "bbox" };
  }

  return { geometry: null, name: null, source: null };
}
