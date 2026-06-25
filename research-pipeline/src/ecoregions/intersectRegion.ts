import path from "node:path";
import Database from "better-sqlite3";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { paths } from "../config.js";
import type { RegionBoundary } from "../regions/resolveRegionBoundary.js";
import type { EcologicalProfile, EcoregionOverlap } from "../types.js";

const DB_PATH = path.join(paths.data, "ecoregions.sqlite");
const MIN_OVERLAP_FRACTION = 0.02;

interface EcoregionRow {
  eco_id: number;
  eco_name: string;
  biome_name: string | null;
  realm: string | null;
  geometry_geojson: string;
}

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    return db;
  } catch {
    console.error(
      `[intersectRegion] Could not open ecoregions.sqlite at ${DB_PATH} — has \`npm run build:ecoregions\` been run?`,
    );
    return null;
  }
}

function toFeature(geometry: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return turf.feature(geometry);
}

/**
 * Intersects a region's boundary polygon against the WWF Ecoregions2017
 * mirror, producing the structured EcologicalProfile that grounds the LLM's
 * ecological-narrative prompt (see analysis/relevanceScoring.ts) — the LLM
 * is only ever shown this structured output, never asked to invent
 * biome/habitat facts on its own. Sub-2% overlaps are dropped so sliver
 * intersections at simplified-polygon boundaries don't add narrative noise.
 */
export function intersectRegion(regionName: string, boundary: RegionBoundary): EcologicalProfile {
  const empty: EcologicalProfile = {
    regionName,
    ecoregions: [],
    dominantBiome: null,
    dominantRealm: null,
    generatedAt: new Date().toISOString(),
  };

  const database = getDb();
  if (!database || !boundary.geometry) return empty;

  let regionFeature: Feature<Polygon | MultiPolygon>;
  let regionArea: number;
  try {
    regionFeature = toFeature(boundary.geometry as Polygon | MultiPolygon);
    regionArea = turf.area(regionFeature);
    if (regionArea <= 0) return empty;
  } catch {
    return empty;
  }

  const rows = database.prepare(`SELECT eco_id, eco_name, biome_name, realm, geometry_geojson FROM ecoregions`).all() as EcoregionRow[];

  const overlaps: EcoregionOverlap[] = [];
  for (const row of rows) {
    let ecoGeometry: Polygon | MultiPolygon;
    try {
      ecoGeometry = JSON.parse(row.geometry_geojson);
    } catch {
      continue;
    }

    let ecoFeature: Feature<Polygon | MultiPolygon>;
    try {
      ecoFeature = toFeature(ecoGeometry);
    } catch {
      continue;
    }

    let intersects = false;
    try {
      intersects = turf.booleanIntersects(regionFeature, ecoFeature);
    } catch {
      continue;
    }
    if (!intersects) continue;

    let intersection;
    try {
      intersection = turf.intersect(turf.featureCollection([regionFeature, ecoFeature]));
    } catch {
      continue;
    }
    if (!intersection) continue;

    const overlapArea = turf.area(intersection);
    const overlapFraction = overlapArea / regionArea;
    if (overlapFraction < MIN_OVERLAP_FRACTION) continue;

    overlaps.push({
      ecoName: row.eco_name,
      biomeName: row.biome_name ?? "Unknown",
      realm: row.realm ?? "Unknown",
      overlapFraction,
    });
  }

  overlaps.sort((a, b) => b.overlapFraction - a.overlapFraction);

  // WWF's "Rock and Ice" / "Lake" categories carry no real biome/realm
  // (literal "N/A" in the source dataset) — they're legitimate land-cover
  // entries to list, but picking one as the "dominant biome" produces a
  // meaningless narrative ("the dominant biome is N/A"). Prefer the
  // highest-overlap entry that has a real biome for that purpose.
  const dominant = overlaps.find((eco) => eco.biomeName !== "N/A" && eco.biomeName !== "Unknown") ?? overlaps[0];

  return {
    regionName,
    ecoregions: overlaps,
    dominantBiome: dominant?.biomeName ?? null,
    dominantRealm: dominant?.realm ?? null,
    generatedAt: new Date().toISOString(),
  };
}
