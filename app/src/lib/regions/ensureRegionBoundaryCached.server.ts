import type { SupabaseClient } from "@supabase/supabase-js";
import { callDataService } from "@/lib/dataService.server";

// Shared by /api/regions/gadm-geometry and /api/regions/osm-boundary (serve
// the Evidence panel's map) and the checklist-creation route (warms the
// cache up front, so the first person to open a brand-new checklist's
// Evidence tab never waits on this).
//
// Two-tier lookup, need-basis: Supabase's `region_boundaries` table is
// checked first (cheap, and only ever holds regions actual checklists have
// used), keyed by (source, cache_key) since boundaries now come from two
// distinct sources:
//  - "gadm": the already-simplified GeoJSON is read straight out of the
//    local GADM mirror (app/data/gadm.sqlite, built by `npm run
//    build:gadm` — per AGENTS.md, that full-world reference mirror stays on
//    the server filesystem, not Supabase). Only ever populated for
//    level-2 (district) GADM GIDs — see scripts/build-gadm.mjs.
//  - "osm": fetched live from Nominatim's polygon lookup (see
//    osmBoundary.server.ts) for regions that have no GADM geometry (any
//    region whose lookup landed above district level, e.g. Sikkim).
// On a miss, the result is cached into Supabase so every later request for
// that region skips the local file / external fetch entirely.
export interface RegionBoundaryResult {
  geometry: unknown | null;
  name: string | null;
}

export type BoundarySource = "gadm" | "osm";

// GADM mirror lives on the standalone reference-data-service
// (DigitalOcean) — see reference-data-service/src/gadm.js's readGadmRow().
async function readGadmRow(gid: string): Promise<RegionBoundaryResult> {
  try {
    return await callDataService<RegionBoundaryResult>(`/gadm/boundary?gid=${encodeURIComponent(gid)}`);
  } catch (err) {
    console.error(`[ensureRegionBoundaryCached] reference-data-service call failed for gid=${gid}`, err);
    return { geometry: null, name: null };
  }
}

/**
 * Resolves and caches a region boundary. `key` is the GADM gid when
 * `source === "gadm"`, or `"<osmType>:<osmId>"` when `source === "osm"`
 * (Nominatim's `osm_id` is only unique combined with `osm_type`, so both
 * must be carried in the key).
 */
export async function ensureRegionBoundaryCached(
  supabase: SupabaseClient,
  source: BoundarySource,
  key: string,
  resolveMiss?: () => Promise<RegionBoundaryResult>,
): Promise<RegionBoundaryResult> {
  const { data: cached, error: cacheReadError } = await supabase
    .from("region_boundaries")
    .select("geometry, name")
    .eq("source", source)
    .eq("cache_key", key)
    .maybeSingle();

  if (cacheReadError) {
    console.error(`[ensureRegionBoundaryCached] Supabase cache read failed for ${source}:${key}`, cacheReadError);
  }

  if (cached?.geometry) {
    return { geometry: cached.geometry, name: cached.name };
  }

  const result = source === "gadm" ? await readGadmRow(key) : (await resolveMiss?.()) ?? { geometry: null, name: null };
  if (!result.geometry) return result;

  // Best-effort cache write — a transient failure here shouldn't surface as
  // an error to the caller; it just means the next request re-resolves.
  const { error: cacheWriteError } = await supabase.rpc("upsert_region_boundary", {
    p_source: source,
    p_cache_key: key,
    p_name: result.name,
    p_geometry: result.geometry,
  });
  if (cacheWriteError) {
    console.error(`[ensureRegionBoundaryCached] Supabase cache write failed for ${source}:${key}`, cacheWriteError);
  }

  return result;
}
