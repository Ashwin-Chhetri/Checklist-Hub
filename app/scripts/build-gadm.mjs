// Builds a local SQLite name->GID lookup DB (app/data/gadm.sqlite) from the
// GADM v4.1 GeoPackage (app/public/data/gadm/gadm_410-gpkg.zip).
//
// We only need GADM's administrative GIDs (the same identifiers GBIF indexes
// occurrences against via the `gadmGid` query param) and human-readable
// names for country/state/district — not full attribute bloat. The zip is
// extracted to a temporary .gpkg file, scanned for GID_0/NAME_0/GID_1/NAME_1/
// GID_2/NAME_2 columns (plus the geometry column for level-2 rows, see
// below), and the temp file is deleted afterwards.
//
// Level-2 (sub-district) rows additionally get a simplified GeoJSON boundary
// (`boundary_geojson`) decoded from the GeoPackage's geometry blob — used by
// the workbench Evidence panel to render a region outline. Geometry is kept
// only at level 2 since that's the level `region_gadm_id` resolves to;
// levels 0/1 never need it, so their `boundary_geojson` stays NULL.
//
// Simplification happens here, once, for every district, rather than lazily
// per-request: vertex count (not text-vs-binary encoding) is what actually
// drives size, and most GADM districts carry thousands of raw coastline
// vertices, so storing them unsimplified — even just for the few districts
// any one deployment ever looks up — isn't actually cheaper than simplifying
// all of them up front. /api/regions/gadm-geometry reads the already-small
// result straight out of this file and caches it into Supabase
// (region_boundaries) the first time a region is actually used by a
// checklist — that's the "need basis" layer; this file itself stays a flat,
// cheap-to-rebuild local mirror, same as the rest of the GADM/GBIF data per
// AGENTS.md.
//
// Usage: node scripts/build-gadm.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ZIP_PATH = path.join(ROOT, "public", "data", "gadm", "gadm_410-gpkg.zip");
const DATA_DIR = path.join(ROOT, "data");
const TMP_GPKG_PATH = path.join(DATA_DIR, "_gadm_410_tmp.gpkg");
const DB_PATH = path.join(DATA_DIR, "gadm.sqlite");

// Degrees of tolerance for Douglas-Peucker simplification — small enough to
// keep a sub-district's shape recognizable at the workbench's small map
// size, large enough to cut GADM's often-thousands-of-vertices rings down to
// a few hundred points at most, keeping per-region payloads and total sqlite
// size small.
const SIMPLIFY_EPSILON_DEG = 0.002;

async function extractGpkg() {
  if (fs.existsSync(TMP_GPKG_PATH)) {
    console.log(`Reusing existing extracted GeoPackage at ${TMP_GPKG_PATH}`);
    return;
  }
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error(`GADM GeoPackage zip not found at ${ZIP_PATH}`);
  }
  console.log("Extracting gadm_410.gpkg from zip (this is several GB, may take a while)...");
  const entry = await fs.createReadStream(ZIP_PATH).pipe(unzipper.ParseOne(/\.gpkg$/));
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(TMP_GPKG_PATH);
    entry.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    entry.on("error", reject);
  });
  console.log("Extraction complete.");
}

/** Find the feature table(s) that carry GADM's GID_0/NAME_0 admin columns. */
function findGadmTables(gpkg) {
  const tables = gpkg
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);

  return tables.filter((name) => {
    const columns = gpkg.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    return columns.includes("GID_0") && columns.includes("NAME_0");
  });
}

/** Geometry column name for a GeoPackage feature table, per its gpkg_geometry_columns metadata (falls back to "geom", the GADM default). */
function geometryColumnName(gpkg, table) {
  try {
    const row = gpkg
      .prepare(`SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?`)
      .get(table);
    return row?.column_name ?? "geom";
  } catch {
    return "geom";
  }
}

/** Douglas-Peucker simplification of a single ring (array of [x,y]) — always keeps the first/last point. */
function simplifyRing(points, epsilon) {
  if (points.length <= 4) return points;

  function perpendicularDistance(p, a, b) {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  function recurse(start, end) {
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      recurse(start, maxIdx);
      recurse(maxIdx, end);
    }
  }
  recurse(0, points.length - 1);

  const result = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  // A polygon ring must stay closed with at least 4 points (3 distinct + repeat
  // of the first) — degenerate simplification falls back to a coarse diamond
  // through the original ring rather than producing invalid geometry.
  if (result.length < 4) {
    return points.length >= 4
      ? [points[0], points[Math.floor(points.length / 2)], points[points.length - 1], points[0]]
      : points;
  }
  return result;
}

/**
 * Reads one WKB geometry (Point/Polygon/MultiPolygon only — all GADM's admin
 * layers use) starting at `offset` in `buf`. Returns { geometry, nextOffset }.
 */
function readWkbGeometry(buf, offset) {
  const littleEndian = buf.readUInt8(offset) === 1;
  offset += 1;
  const type = littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  offset += 4;

  function readDouble() {
    const v = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
    offset += 8;
    return v;
  }
  function readUInt32() {
    const v = littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
    offset += 4;
    return v;
  }
  function readRing() {
    const numPoints = readUInt32();
    const ring = [];
    for (let i = 0; i < numPoints; i++) ring.push([readDouble(), readDouble()]);
    return ring;
  }
  function readPolygonRings() {
    const numRings = readUInt32();
    const rings = [];
    for (let i = 0; i < numRings; i++) rings.push(readRing());
    return rings;
  }

  if (type === 1) {
    const x = readDouble();
    const y = readDouble();
    return { geometry: { type: "Point", coordinates: [x, y] }, nextOffset: offset };
  }
  if (type === 3) {
    const rings = readPolygonRings();
    return { geometry: { type: "Polygon", coordinates: rings }, nextOffset: offset };
  }
  if (type === 6) {
    const numPolygons = readUInt32();
    const polygons = [];
    for (let i = 0; i < numPolygons; i++) {
      // Each sub-polygon repeats its own byte-order+type header, same as a
      // standalone WKB Polygon — standard (if redundant) WKB multi-geometry nesting.
      const sub = readWkbGeometry(buf, offset);
      offset = sub.nextOffset;
      if (sub.geometry?.type === "Polygon") polygons.push(sub.geometry.coordinates);
    }
    return { geometry: { type: "MultiPolygon", coordinates: polygons }, nextOffset: offset };
  }
  // Unsupported geometry type — not expected from GADM's polygon admin layers.
  return { geometry: null, nextOffset: buf.length };
}

const ENVELOPE_DOUBLE_COUNTS = { 0: 0, 1: 4, 2: 6, 3: 6, 4: 8 };

/** Decodes a GeoPackage geometry BLOB (GPB header + standard WKB) into a simplified GeoJSON geometry, or null. */
function decodeGpkgGeometry(blob) {
  if (!blob || blob.length < 8) return null;
  // GPB header: magic 'G' 'P', version, flags, srs_id (int32), [envelope], then WKB.
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return null;
  const flags = blob[3];
  const envelopeCode = (flags >> 1) & 0x07;
  const isEmpty = (flags >> 4) & 0x01;
  if (isEmpty) return null;
  const envelopeDoubles = ENVELOPE_DOUBLE_COUNTS[envelopeCode] ?? 0;
  const wkbOffset = 8 + envelopeDoubles * 8;

  let parsed;
  try {
    parsed = readWkbGeometry(blob, wkbOffset);
  } catch {
    return null;
  }
  if (!parsed.geometry) return null;

  const geom = parsed.geometry;
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map((ring) => simplifyRing(ring, SIMPLIFY_EPSILON_DEG)) };
  }
  if (geom.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geom.coordinates.map((rings) => rings.map((ring) => simplifyRing(ring, SIMPLIFY_EPSILON_DEG))),
    };
  }
  return null;
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  return extractGpkg().then(() => {
    const gpkg = new Database(TMP_GPKG_PATH, { readonly: true, fileMustExist: true });

    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = OFF");

    db.exec(`
      CREATE TABLE gadm_regions (
        gid TEXT PRIMARY KEY,
        level INTEGER NOT NULL,
        name TEXT NOT NULL,
        country_name TEXT,
        state_name TEXT,
        district_name TEXT,
        parent_gid TEXT,
        boundary_geojson TEXT
      );
    `);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO gadm_regions (gid, level, name, country_name, state_name, district_name, parent_gid, boundary_geojson)
      VALUES (@gid, @level, @name, @country_name, @state_name, @district_name, @parent_gid, @boundary_geojson)
    `);

    const tables = findGadmTables(gpkg);
    if (tables.length === 0) {
      throw new Error("No GADM admin tables (with GID_0/NAME_0 columns) found in the GeoPackage.");
    }
    console.log(`Found GADM table(s): ${tables.join(", ")}`);

    let total = 0;
    let withGeometry = 0;
    const flush = db.transaction((rows) => {
      for (const row of rows) insert.run(row);
    });

    for (const table of tables) {
      const columns = gpkg.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      const has = (col) => columns.includes(col);
      const geomCol = geometryColumnName(gpkg, table);
      const hasGeom = has(geomCol);

      const selectCols = ["GID_0", "NAME_0"];
      if (has("GID_1")) selectCols.push("GID_1", "NAME_1");
      if (has("GID_2")) selectCols.push("GID_2", "NAME_2");
      if (has("GID_2") && hasGeom) selectCols.push(geomCol);

      const stmt = gpkg.prepare(`SELECT ${selectCols.map((c) => `"${c}"`).join(", ")} FROM "${table}"`);

      let batch = [];
      for (const row of stmt.iterate()) {
        const gid0 = row.GID_0;
        const name0 = row.NAME_0;
        if (!gid0 || !name0) continue;

        batch.push({
          gid: gid0,
          level: 0,
          name: name0,
          country_name: name0,
          state_name: null,
          district_name: null,
          parent_gid: null,
          boundary_geojson: null,
        });

        const gid1 = row.GID_1;
        const name1 = row.NAME_1;
        if (gid1 && name1) {
          batch.push({
            gid: gid1,
            level: 1,
            name: name1,
            country_name: name0,
            state_name: name1,
            district_name: null,
            parent_gid: gid0,
            boundary_geojson: null,
          });

          const gid2 = row.GID_2;
          const name2 = row.NAME_2;
          if (gid2 && name2) {
            let boundaryGeojson = null;
            if (hasGeom && row[geomCol]) {
              const decoded = decodeGpkgGeometry(row[geomCol]);
              if (decoded) {
                boundaryGeojson = JSON.stringify(decoded);
                withGeometry++;
              }
            }
            batch.push({
              gid: gid2,
              level: 2,
              name: name2,
              country_name: name0,
              state_name: name1,
              district_name: name2,
              parent_gid: gid1,
              boundary_geojson: boundaryGeojson,
            });
          }
        }

        if (batch.length >= 5000) {
          flush(batch);
          total += batch.length;
          batch = [];
        }
      }
      if (batch.length > 0) {
        flush(batch);
        total += batch.length;
      }
    }

    db.exec(`CREATE INDEX idx_gadm_regions_names ON gadm_regions(country_name, state_name, district_name)`);
    db.exec(`CREATE INDEX idx_gadm_regions_name ON gadm_regions(name)`);

    db.close();
    gpkg.close();

    fs.unlinkSync(TMP_GPKG_PATH);

    console.log(
      `Wrote ~${total} rows (incl. duplicates resolved via INSERT OR IGNORE) to ${DB_PATH}, ${withGeometry} with a boundary_geojson.`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
