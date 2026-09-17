import { simplifyGeometry, type SimpleGeometry } from "@/lib/geo/simplify";
import type { RegionBoundaryResult } from "./ensureRegionBoundaryCached.server";

// Fetches a region's boundary polygon directly from Nominatim (OpenStreetMap),
// used whenever GADM has no stored geometry for the region (GADM only stores
// boundaries for level-2/district GIDs — see scripts/build-gadm.mjs — so any
// region whose lookup landed at state/country level, e.g. Sikkim, has none).
// Shared by /api/regions/osm-boundary (on-demand fetch for the Evidence
// panel) and the checklist-creation route's cache pre-warm.
const NOMINATIM_API = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "checklist-hub/1.0 (biodiversity checklist region lookup)",
};
const OSM_TYPE_PREFIX: Record<string, string> = { node: "N", way: "W", relation: "R" };
const FETCH_TIMEOUT_MS = 5000;

interface NominatimAddress {
  county?: string;
  state_district?: string;
  district?: string;
  city?: string;
  municipality?: string;
  town?: string;
  borough?: string;
  state?: string;
  province?: string;
  region?: string;
  country?: string;
}

interface NominatimLookupResult {
  display_name?: string;
  geojson?: { type: string; coordinates: unknown };
  address?: NominatimAddress;
}

async function nominatimFetch(path: string, params: Record<string, string>): Promise<NominatimLookupResult[]> {
  const url = new URL(`${NOMINATIM_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: NOMINATIM_HEADERS, signal: controller.signal });
    if (!response.ok) {
      console.error(`[osmBoundary] Nominatim ${path} failed: HTTP ${response.status}`);
      return [];
    }
    return (await response.json()) as NominatimLookupResult[];
  } catch (err) {
    console.error(`[osmBoundary] Nominatim ${path} errored`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function toRegionResult(match: NominatimLookupResult | undefined): RegionBoundaryResult & { hasPolygon: boolean } {
  const geojson = match?.geojson;
  if (!geojson || (geojson.type !== "Polygon" && geojson.type !== "MultiPolygon")) {
    return { geometry: null, name: match?.display_name ?? null, hasPolygon: false };
  }
  const simplified = simplifyGeometry(geojson as SimpleGeometry);
  return { geometry: simplified, name: match!.display_name ?? null, hasPolygon: true };
}

/**
 * Same district/state/country extraction priority as regionApi.ts's
 * buildResolvedRegion (client side) — kept as a small duplicate rather than
 * a shared import since this runs server-side against Nominatim's raw
 * address block, not the app's own ResolvedRegion shape.
 */
function addressDistrictQuery(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  const district = address.state_district || address.county || address.district || address.city || address.municipality || address.town || address.borough;
  const state = address.state || address.province || address.region;
  const country = address.country;
  if (!district || !country) return null;
  return state ? `${district} District, ${state}, ${country}` : `${district} District, ${country}`;
}

/**
 * Looks up the real administrative boundary enclosing an address breakdown —
 * queries Nominatim's forward search with an explicit "<district>
 * District, <state>, <country>" string, the same query shape the design
 * prototype uses (prototypes/map-view-phase0-darjeeling.html's
 * `REGION_QUERY`), which reliably ranks the boundary relation above any
 * same-named place/city node. Needed because a *directly* selected OSM
 * element can be a bare point (e.g. a city/town node for "Darjeeling" ranks
 * above the district relation in Nominatim's own free-text search — verified
 * live) with no polygon of its own at all.
 */
async function lookupAdministrativeBoundary(address: NominatimAddress | undefined): Promise<RegionBoundaryResult | null> {
  const query = addressDistrictQuery(address);
  if (!query) return null;
  const results = await nominatimFetch("/search", { q: query, format: "jsonv2", polygon_geojson: "1", addressdetails: "1", limit: "1" });
  const resolved = toRegionResult(results[0]);
  return resolved.hasPolygon ? resolved : null;
}

export async function fetchOsmGeometry(osmType: string, osmId: string): Promise<RegionBoundaryResult> {
  const prefix = OSM_TYPE_PREFIX[osmType];
  if (!prefix) {
    console.error(`[osmBoundary] Unrecognized osm_type "${osmType}" for osm_id=${osmId}`);
    return { geometry: null, name: null };
  }

  const results = await nominatimFetch("/lookup", { osm_ids: `${prefix}${osmId}`, format: "jsonv2", polygon_geojson: "1", addressdetails: "1" });
  const direct = toRegionResult(results[0]);
  if (direct.hasPolygon) return direct;

  console.warn(`[osmBoundary] No Polygon/MultiPolygon for ${prefix}${osmId} (likely a point/place, not a boundary) — resolving its enclosing administrative boundary instead`);
  const admin = await lookupAdministrativeBoundary(results[0]?.address);
  if (admin) return admin;

  return { geometry: null, name: direct.name };
}
