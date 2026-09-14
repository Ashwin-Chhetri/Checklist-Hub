#!/usr/bin/env node
/**
 * Samples random level-2 (district) rows from the world-wide GADM mirror and
 * checks, for each one, that:
 *
 *   1. The GADM code (gid) resolves correctly — re-running the same
 *      country/state/district name lookup that
 *      reference-data-service/src/gadm.js's lookup() performs (the function
 *      behind /api/regions/gadm-lookup) must land back on that district's
 *      own gid.
 *   2. The district's boundary ("shapefile") was created and can be fetched
 *      properly — the same boundary_geojson read that gadm.js's
 *      readGadmRow() performs (the function behind /api/regions/gadm-geometry
 *      and the checklist-creation cache warm) must return valid, non-empty
 *      Polygon/MultiPolygon GeoJSON with in-range coordinates and closed
 *      rings.
 *
 * This talks to the local GADM SQLite mirror directly (app/data/gadm.sqlite)
 * rather than over HTTP, since that file — not the network path in front of
 * it — is the actual source of truth for both lookups (see AGENTS.md: heavy
 * reference data lives on the server filesystem, read via better-sqlite3).
 * The lookup/read logic below is intentionally a small mirror of gadm.js's
 * functions, same as gadm.js's own header already notes it mirrors the
 * app-server code it was ported from.
 *
 * Requires app/data/gadm.sqlite to exist locally — build it with
 * `npm run build:gadm` (needs public/data/gadm/gadm_410-gpkg.zip) or point
 * GADM_DB_PATH / DATA_DIR at a copy of the file from a deployment that has
 * already built it.
 *
 * Usage:
 *   node scripts/test-gadm-districts.mjs
 *   SAMPLE_SIZE=200 node scripts/test-gadm-districts.mjs
 *   GADM_DB_PATH=/path/to/gadm.sqlite node scripts/test-gadm-districts.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DB_PATH =
  process.env.GADM_DB_PATH ||
  path.join(process.env.DATA_DIR || path.join(ROOT, "data"), "gadm.sqlite");

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE) > 0 ? Number(process.env.SAMPLE_SIZE) : 500;
const MAX_PRINTED_FAILURES = 40;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const GID_2_PATTERN = /^[A-Za-z]{3}\.\d+\.\d+_\d+$/;

if (!fs.existsSync(DB_PATH)) {
  console.error(`${RED}GADM SQLite mirror not found at ${DB_PATH}${RESET}`);
  console.error(
    "Build it with `npm run build:gadm` (needs public/data/gadm/gadm_410-gpkg.zip), " +
      "or set GADM_DB_PATH / DATA_DIR to a copy of an already-built gadm.sqlite.",
  );
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// Mirrors reference-data-service/src/gadm.js's lookup() — exact match on
// (country, state, district), falling back to a 4-char district-name prefix
// match, exactly as the production /gadm/lookup handler does.
function lookupByName({ country, state, district }) {
  if (!country || !state || !district) return null;

  const exact = db
    .prepare(
      `SELECT gid, level, name FROM gadm_regions
       WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) = lower(?)`,
    )
    .get(country, state, district);
  if (exact) return exact;

  const prefix = district.slice(0, 4);
  if (prefix.length >= 4) {
    const fuzzy = db
      .prepare(
        `SELECT gid, level, name FROM gadm_regions
         WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) LIKE lower(?) || '%'`,
      )
      .get(country, state, prefix);
    if (fuzzy) return fuzzy;
  }
  return null;
}

// Mirrors reference-data-service/src/gadm.js's readGadmRow().
function readBoundary(gid) {
  const row = db.prepare(`SELECT boundary_geojson, name FROM gadm_regions WHERE gid = ?`).get(gid);
  if (!row?.boundary_geojson) return { geometry: null, name: row?.name ?? null };
  try {
    return { geometry: JSON.parse(row.boundary_geojson), name: row.name };
  } catch {
    return { geometry: null, name: row.name };
  }
}

/** Validates a single [lon, lat] pair. */
function validPoint(pt) {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    Number.isFinite(pt[0]) &&
    Number.isFinite(pt[1]) &&
    pt[0] >= -180 &&
    pt[0] <= 180 &&
    pt[1] >= -90 &&
    pt[1] <= 90
  );
}

/** Validates a single ring: closed, >= 4 points, every point in range. */
function validRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return "ring has fewer than 4 points";
  for (const pt of ring) {
    if (!validPoint(pt)) return `ring has an out-of-range or non-numeric point (${JSON.stringify(pt)})`;
  }
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return "ring is not closed (first point != last point)";
  return null;
}

/** Validates a Polygon/MultiPolygon geometry, returning an error string or null. */
function validGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return "geometry is missing or not an object";
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return `unexpected geometry type "${geometry.type}"`;
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return "geometry has no coordinates";
  }

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return "polygon has no rings";
    for (const ring of polygon) {
      const err = validRing(ring);
      if (err) return err;
    }
  }
  return null;
}

function main() {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM gadm_regions WHERE level = 2`).get().n;
  if (total === 0) {
    console.error(`${RED}No level-2 (district) rows found in ${DB_PATH}${RESET}`);
    process.exit(1);
  }

  const sampleSize = Math.min(SAMPLE_SIZE, total);
  const districts = db
    .prepare(
      `SELECT gid, name, country_name, state_name, district_name, parent_gid FROM gadm_regions
       WHERE level = 2 ORDER BY RANDOM() LIMIT ?`,
    )
    .all(sampleSize);

  console.log(
    `\nTesting ${districts.length} randomly sampled districts out of ${total} world-wide (${DB_PATH})\n`,
  );

  let gidPassed = 0;
  let boundaryPassed = 0;
  const failures = [];

  for (const [i, d] of districts.entries()) {
    const label = `${String(i + 1).padStart(4)}. ${d.country_name} / ${d.state_name} / ${d.district_name} (${d.gid})`;
    const rowFailures = [];

    // 1. GADM code fetch: the district's own name-triple must resolve back
    // to its own gid, and the gid itself must look like a real GADM GID_2.
    if (!GID_2_PATTERN.test(d.gid)) {
      rowFailures.push(`gid "${d.gid}" doesn't match GADM's GID_2 pattern`);
    }
    const looked = lookupByName({ country: d.country_name, state: d.state_name, district: d.district_name });
    if (!looked) {
      rowFailures.push("name lookup found no match at all");
    } else if (looked.gid !== d.gid) {
      rowFailures.push(`name lookup resolved to ${looked.gid} instead of ${d.gid}`);
    } else if (looked.level !== 2) {
      rowFailures.push(`name lookup resolved at level ${looked.level}, expected 2`);
    }
    if (rowFailures.length === 0) gidPassed++;

    // 2. District shapefile fetch: boundary_geojson must exist and parse
    // into a valid, non-empty, closed-ring Polygon/MultiPolygon.
    const boundaryFailuresBefore = rowFailures.length;
    const { geometry } = readBoundary(d.gid);
    const geomErr = validGeometry(geometry);
    if (geomErr) rowFailures.push(`boundary invalid: ${geomErr}`);
    if (rowFailures.length === boundaryFailuresBefore) boundaryPassed++;

    // 3. Hierarchy sanity: the district's parent should be a real level-1
    // row in the same country.
    if (d.parent_gid) {
      const parent = db.prepare(`SELECT level, country_name FROM gadm_regions WHERE gid = ?`).get(d.parent_gid);
      if (!parent) rowFailures.push(`parent_gid ${d.parent_gid} does not exist`);
      else if (parent.level !== 1) rowFailures.push(`parent_gid ${d.parent_gid} is level ${parent.level}, expected 1`);
      else if (parent.country_name !== d.country_name)
        rowFailures.push(`parent country "${parent.country_name}" != district country "${d.country_name}"`);
    } else {
      rowFailures.push("missing parent_gid");
    }

    if (rowFailures.length === 0) {
      console.log(`${GREEN}PASS${RESET} ${label}`);
    } else {
      failures.push({ label, rowFailures });
      console.log(`${RED}FAIL${RESET} ${label}`);
      for (const f of rowFailures) console.log(`     ${RED}${f}${RESET}`);
    }
  }

  console.log(
    `\n${DIM}gid lookup: ${gidPassed}/${districts.length} passed · boundary: ${boundaryPassed}/${districts.length} passed${RESET}`,
  );
  console.log(`${failures.length === 0 ? GREEN : RED}${districts.length - failures.length}/${districts.length} districts fully passed${RESET}\n`);

  if (failures.length > 0) {
    console.log(`Failures (showing up to ${MAX_PRINTED_FAILURES}):`);
    for (const { label, rowFailures } of failures.slice(0, MAX_PRINTED_FAILURES)) {
      console.log(`  - ${label}: ${rowFailures.join("; ")}`);
    }
    console.log("");
    db.close();
    process.exit(1);
  }

  db.close();
}

main();
