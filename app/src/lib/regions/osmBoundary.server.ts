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

interface NominatimLookupResult {
  display_name?: string;
  geojson?: { type: string; coordinates: unknown };
}

export async function fetchOsmGeometry(osmType: string, osmId: string): Promise<RegionBoundaryResult> {
  const prefix = OSM_TYPE_PREFIX[osmType];
  if (!prefix) {
    console.error(`[osmBoundary] Unrecognized osm_type "${osmType}" for osm_id=${osmId}`);
    return { geometry: null, name: null };
  }

  const url = new URL(`${NOMINATIM_API}/lookup`);
  url.searchParams.set("osm_ids", `${prefix}${osmId}`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("polygon_geojson", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let results: NominatimLookupResult[];
  try {
    const response = await fetch(url.toString(), { headers: NOMINATIM_HEADERS, signal: controller.signal });
    if (!response.ok) {
      console.error(`[osmBoundary] Nominatim lookup failed for ${prefix}${osmId}: HTTP ${response.status}`);
      return { geometry: null, name: null };
    }
    results = (await response.json()) as NominatimLookupResult[];
  } catch (err) {
    console.error(`[osmBoundary] Nominatim lookup errored for ${prefix}${osmId}`, err);
    return { geometry: null, name: null };
  } finally {
    clearTimeout(timeout);
  }

  const match = results[0];
  const geojson = match?.geojson;
  if (!geojson || (geojson.type !== "Polygon" && geojson.type !== "MultiPolygon")) {
    console.warn(`[osmBoundary] No Polygon/MultiPolygon geometry returned by Nominatim for ${prefix}${osmId}`);
    return { geometry: null, name: match?.display_name ?? null };
  }

  const simplified = simplifyGeometry(geojson as SimpleGeometry);
  return { geometry: simplified, name: match.display_name ?? null };
}
