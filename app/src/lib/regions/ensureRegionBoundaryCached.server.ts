import path from "node:path";
import Database from "better-sqlite3";
import type { SupabaseClient } from "@supabase/supabase-js";

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
const DB_PATH = path.join(process.cwd(), "data", "gadm.sqlite");

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    return db;
  } catch (err) {
    console.error("[ensureRegionBoundaryCached] Could not open gadm.sqlite — has `npm run build:gadm` been run?", err);
    return null;
  }
}

interface LocalRow {
  boundary_geojson: string | null;
  name: string;
}

export interface RegionBoundaryResult {
  geometry: unknown | null;
  name: string | null;
}

export type BoundarySource = "gadm" | "osm";

function readGadmRow(gid: string): RegionBoundaryResult {
  const database = getDb();
  if (!database) return { geometry: null, name: null };

  const row = database
    .prepare(`SELECT boundary_geojson, name FROM gadm_regions WHERE gid = ?`)
    .get(gid) as LocalRow | undefined;

  if (!row?.boundary_geojson) {
    console.warn(`[ensureRegionBoundaryCached] No GADM boundary stored for gid=${gid} (only level-2/district GIDs have one).`);
    return { geometry: null, name: row?.name ?? null };
  }

  try {
    return { geometry: JSON.parse(row.boundary_geojson), name: row.name };
  } catch (err) {
    console.error(`[ensureRegionBoundaryCached] Failed to parse stored GADM geometry for gid=${gid}`, err);
    return { geometry: null, name: row.name };
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

  const result = source === "gadm" ? readGadmRow(key) : await resolveMiss?.() ?? { geometry: null, name: null };
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
