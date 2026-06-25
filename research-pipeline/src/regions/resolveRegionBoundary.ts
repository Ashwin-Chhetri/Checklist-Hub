import fs from "node:fs/promises";
import path from "node:path";
import { simplifyGeometry, type SimpleGeometry } from "./geoSimplify.js";
import { paths } from "../config.js";

// Ports the *logic* of ../app/src/lib/regions/osmBoundary.server.ts, but
// resolves by free-text region name via Nominatim's /search endpoint rather
// than /lookup-by-known-osm-id — this standalone pipeline takes a region
// name as CLI input, not a pre-resolved GADM/OSM id. The app's two-tier
// GADM-then-OSM-fallback system is deliberately not ported here (per plan:
// "start with OSM-only region resolution for phase 1" — copying the
// multi-GB GADM GeoPackage asset is only worth it if OSM polygon quality
// proves insufficient during manual verification). Caches to a local JSON
// file instead of Supabase.
const NOMINATIM_API = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "checklisthub-research-pipeline/0.1 (biodiversity literature research tool)",
};
const FETCH_TIMEOUT_MS = 8000;

export interface RegionBoundary {
  name: string | null;
  geometry: SimpleGeometry | null;
  bbox: [number, number, number, number] | null;
  /**
   * Nominatim's structured address breakdown (requested via
   * `addressdetails=1`) — the robust alternative to parsing `display_name`
   * as a plain comma-separated string. Real bug found via a random
   * multi-region test: "Cusco Province, Peru" found no admin-boundary
   * polygon in Nominatim's top results and fell back to a street address
   * ("387, Calle Las Rosas, Ticapata, San Sebastián, Cusco, 08006, Perú"),
   * whose first comma-segment ("387", a building number) is garbage as a
   * "most specific region token." `country`/`state`/`county` are explicit,
   * labeled fields regardless of which result tier Nominatim matched —
   * preliminaryRelevance.ts's wrong-region detection uses these instead of
   * display_name's positional guessing wherever available.
   */
  address: {
    country?: string;
    state?: string;
    /** OSM/Nominatim labels a "district" admin level as `state_district` in some countries (e.g. India's "Darjeeling district") and as `county` in others — both are checked. */
    state_district?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
  } | null;
}

interface NominatimSearchResult {
  display_name?: string;
  boundingbox?: [string, string, string, string];
  geojson?: { type: string; coordinates: unknown };
  address?: {
    country?: string;
    state?: string;
    state_district?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
  };
}

function cacheKeyFor(regionName: string): string {
  return regionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function cachePath(regionName: string): string {
  return path.join(paths.data, "region-boundary-cache", `${cacheKeyFor(regionName)}.json`);
}

async function readCache(regionName: string): Promise<RegionBoundary | null> {
  try {
    const raw = await fs.readFile(cachePath(regionName), "utf8");
    return JSON.parse(raw) as RegionBoundary;
  } catch {
    return null;
  }
}

async function writeCache(regionName: string, boundary: RegionBoundary): Promise<void> {
  const filePath = cachePath(regionName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(boundary, null, 2));
}

/**
 * Resolves a free-text region name (e.g. "Darjeeling district, West
 * Bengal") to a simplified boundary polygon + bbox via Nominatim, caching
 * the result to a local file (region boundaries don't change, so this never
 * needs to be re-fetched once resolved successfully).
 */
export async function resolveRegionBoundary(regionName: string): Promise<RegionBoundary> {
  const cached = await readCache(regionName);
  if (cached) return cached;

  const url = new URL(`${NOMINATIM_API}/search`);
  url.searchParams.set("q", regionName);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("polygon_geojson", "1");
  // Real bug found via a random multi-region test run: without this,
  // Nominatim returns localized place names by default (e.g. "Bayern" /
  // "Deutschland" for a "Bavaria, Germany" query) — display_name AND the
  // structured address fields both come back German, which then mismatches
  // every English-language paper that actually says "Bavaria"/"Germany",
  // and even flagged a genuinely on-topic paper as wrongCountrySignal
  // (COUNTRY_NAMES' English "germany" wasn't recognized as the same place
  // as the resolved "Deutschland"). This pipeline's literature corpus is
  // overwhelmingly English-language academic writing, so English place
  // names are what actually need to match, regardless of which country is
  // being searched.
  url.searchParams.set("accept-language", "en");
  // Structured address breakdown (country/state/county/city/...) — see
  // RegionBoundary.address's doc comment for why this matters even when no
  // polygon match is found: a real test run against "Cusco Province, Peru"
  // found no admin-boundary polygon and fell back to a street-address-level
  // match, but Nominatim still labels that address's country/state/county
  // explicitly regardless of which result tier matched.
  url.searchParams.set("addressdetails", "1");
  // Ask for several candidates rather than just the top one — Nominatim's
  // top-ranked match for an ambiguous bare name (e.g. "Darjeeling") is often
  // a point-level result (a town/postal code), with the actual admin-area
  // polygon (e.g. the district) ranked lower. Picking the first result with
  // real Polygon/MultiPolygon geometry, rather than blindly using results[0],
  // is what makes this resolve correctly for short/ambiguous region names.
  url.searchParams.set("limit", "5");

  const result: RegionBoundary = { name: null, geometry: null, bbox: null, address: null };

  try {
    const response = await fetch(url.toString(), {
      headers: NOMINATIM_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return result;

    const results = (await response.json()) as NominatimSearchResult[];
    if (results.length === 0) return result;

    const polygonMatch = results.find(
      (r) => r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon"),
    );
    const match = polygonMatch ?? results[0];
    if (!match) return result;

    result.address = match.address ?? null;

    result.name = match.display_name ?? null;
    if (match.boundingbox) {
      const [south, north, west, east] = match.boundingbox.map(Number);
      result.bbox = [west, south, east, north];
    }

    const geojson = match.geojson;
    if (geojson && (geojson.type === "Polygon" || geojson.type === "MultiPolygon")) {
      result.geometry = simplifyGeometry(geojson as SimpleGeometry);
    }
  } catch {
    return result;
  }

  if (result.geometry) await writeCache(regionName, result);
  return result;
}

/**
 * Builds a most-specific-first hierarchy string (e.g. "Cusco, Cusco,
 * Peru") from `RegionBoundary.address`'s explicit, labeled fields, for
 * callers (preliminaryRelevance.ts via runPipeline.ts) that need to know
 * what specific/broader place names to look for in a candidate's text.
 * Strictly more reliable than parsing `RegionBoundary.name` (Nominatim's
 * free-text `display_name`) by comma position: a real bug found via a
 * random multi-region test run had "Cusco Province, Peru" resolve to a
 * street address with no admin-boundary polygon, where `display_name`'s
 * first comma-segment was "387" (a building number) — `address.country`/
 * `state`/`county`/city-level fields are still correctly labeled by
 * Nominatim regardless of which result tier actually matched. Falls back
 * to `fallbackName` (the original boundary.name, or the raw user input)
 * when no structured address came back at all.
 */
export function buildRegionHierarchy(boundary: RegionBoundary, fallbackName: string): string {
  if (!boundary.address) return boundary.name ?? fallbackName;
  const { city, town, village, municipality, suburb, county, state_district, state, country } = boundary.address;
  const segments = [city ?? town ?? village ?? municipality ?? suburb, county ?? state_district, state, country].filter(
    (s): s is string => Boolean(s),
  );
  return segments.length > 0 ? segments.join(", ") : boundary.name ?? fallbackName;
}
