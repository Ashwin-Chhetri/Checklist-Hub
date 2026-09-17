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
 * Resolves the real administrative boundary for a district/state/country
 * name triple — queries Nominatim's forward search with an explicit
 * "<district> District, <state>, <country>" string, the same query shape
 * the design prototype uses (prototypes/map-view-phase0-darjeeling.html's
 * `REGION_QUERY`) and the *only* boundary source it uses at all. Verified
 * live against Nominatim: for "Darjeeling", this ranks the actual district
 * relation first, whereas a bare place-name search ranks the town/city node
 * above it. This is now this app's PRIMARY boundary source (see
 * regionApi.ts's fetchRegionBoundary) — preferred even over a resolved
 * `region_gadm_id`, because GADM's own bundled geometry can be a stale or
 * differently-digitized vintage of a district's boundary (confirmed for
 * Darjeeling specifically: GADM v4.1's stored shape visibly disagrees with
 * OSM's actively-maintained relation). `region_gadm_id` itself is untouched
 * by this — it's still resolved and stored purely so GBIF occurrence
 * queries can scope to it (see regionApi.ts's resolveGadmId doc comment).
 */
export async function resolveAdministrativeBoundaryByName(
  district: string | null | undefined,
  state: string | null | undefined,
  country: string | null | undefined,
): Promise<RegionBoundaryResult | null> {
  if (!district || !country) return null;
  const query = state ? `${district} District, ${state}, ${country}` : `${district} District, ${country}`;
  const results = await nominatimFetch("/search", { q: query, format: "jsonv2", polygon_geojson: "1", addressdetails: "1", limit: "1" });
  const resolved = toRegionResult(results[0]);
  return resolved.hasPolygon ? resolved : null;
}

/**
 * Same district/state/country extraction priority as regionApi.ts's
 * buildResolvedRegion (client side) — kept as a small duplicate rather than
 * a shared import since this runs server-side against Nominatim's raw
 * address block, not the app's own ResolvedRegion shape.
 */
function addressToTriple(address: NominatimAddress | undefined): { district?: string; state?: string; country?: string } {
  if (!address) return {};
  return {
    district: address.state_district || address.county || address.district || address.city || address.municipality || address.town || address.borough,
    state: address.state || address.province || address.region,
    country: address.country,
  };
}

/**
 * Resolves a boundary for one *specific* OSM element (a saved
 * osm_type/osm_id pair) — used only as a fallback when neither GADM nor
 * resolveAdministrativeBoundaryByName above can be tried (no district/state/
 * country on record for this region, e.g. very old checklists). A directly
 * selected OSM element can be a bare point (e.g. a city/town node) with no
 * polygon of its own — in that case this falls back to resolving its
 * enclosing administrative boundary via its own address breakdown.
 */
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
  const triple = addressToTriple(results[0]?.address);
  const admin = await resolveAdministrativeBoundaryByName(triple.district, triple.state, triple.country);
  if (admin) return admin;

  return { geometry: null, name: direct.name };
}
