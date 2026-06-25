// Builds a local SQLite mirror (research-pipeline/data/ecoregions.sqlite)
// from the WWF/RESOLVE "Ecoregions2017" terrestrial ecoregions dataset
// (825 polygons, CC-BY 4.0, https://ecoregions.appspot.com/). Mirrors the
// pattern in ../app/scripts/build-gadm.mjs: download once, simplify
// geometry once at build time, never put this heavy reference data in
// Supabase — keep it as a flat local file this CLI tool reads read-only.
//
// Usage: node scripts/build-ecoregions.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import shapefile from "shapefile";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const ZIP_PATH = path.join(DATA_DIR, "Ecoregions2017.zip");
const EXTRACT_DIR = path.join(DATA_DIR, "_ecoregions2017_tmp");
const DB_PATH = path.join(DATA_DIR, "ecoregions.sqlite");
const DOWNLOAD_URL = "https://storage.googleapis.com/teow2016/Ecoregions2017.zip";

// Same tolerance philosophy as build-gadm.mjs: ecoregion polygons are even
// larger/more numerous than GADM districts, so simplification matters just
// as much.
const SIMPLIFY_EPSILON_DEG = 0.01;

async function downloadZip() {
  if (fs.existsSync(ZIP_PATH)) {
    console.log(`Reusing existing download at ${ZIP_PATH}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Downloading ${DOWNLOAD_URL} (~150MB, this may take a while)...`);
  const response = await fetch(DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Ecoregions2017.zip: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(ZIP_PATH, buffer);
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB.`);
}

async function extractShapefile() {
  if (fs.existsSync(EXTRACT_DIR)) {
    console.log(`Reusing existing extracted shapefile at ${EXTRACT_DIR}`);
    return;
  }
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  console.log("Extracting shapefile components from zip...");
  const directory = await unzipper.Open.file(ZIP_PATH);
  for (const entry of directory.files) {
    const lower = entry.path.toLowerCase();
    if (!/\.(shp|dbf|shx)$/.test(lower)) continue;
    const ext = lower.slice(lower.lastIndexOf("."));
    const outPath = path.join(EXTRACT_DIR, `Ecoregions2017${ext}`);
    await new Promise((resolve, reject) => {
      entry
        .stream()
        .pipe(fs.createWriteStream(outPath))
        .on("finish", resolve)
        .on("error", reject);
    });
  }
  console.log("Extraction complete.");
}

/** Douglas-Peucker simplification of a single ring — same algorithm as build-gadm.mjs, duplicated rather than imported across the app/research-pipeline boundary by design (see README "Design notes": no shared runtime). */
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
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
  for (let i = 0; i < points.length; i++) if (keep[i]) result.push(points[i]);
  if (result.length < 4) {
    return points.length >= 4
      ? [points[0], points[Math.floor(points.length / 2)], points[points.length - 1], points[0]]
      : points;
  }
  return result;
}

function simplifyGeometry(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, SIMPLIFY_EPSILON_DEG)) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((rings) => rings.map((ring) => simplifyRing(ring, SIMPLIFY_EPSILON_DEG))),
    };
  }
  return geometry;
}

async function main() {
  await downloadZip();
  await extractShapefile();

  const shpPath = path.join(EXTRACT_DIR, "Ecoregions2017.shp");
  const dbfPath = path.join(EXTRACT_DIR, "Ecoregions2017.dbf");

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");

  db.exec(`
    CREATE TABLE ecoregions (
      eco_id INTEGER PRIMARY KEY,
      eco_name TEXT NOT NULL,
      biome_name TEXT,
      biome_num INTEGER,
      realm TEXT,
      geometry_geojson TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ecoregions (eco_id, eco_name, biome_name, biome_num, realm, geometry_geojson)
    VALUES (@eco_id, @eco_name, @biome_name, @biome_num, @realm, @geometry_geojson)
  `);
  const flush = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  console.log("Reading shapefile features (this can take a few minutes for ~825 polygons)...");
  const source = await shapefile.open(shpPath, dbfPath);
  let count = 0;
  let batch = [];
  let result = await source.read();
  while (!result.done) {
    const feature = result.value;
    const props = feature.properties ?? {};
    const simplified = simplifyGeometry(feature.geometry);
    if (simplified) {
      batch.push({
        eco_id: Number(props.ECO_ID ?? props.eco_id ?? count),
        eco_name: String(props.ECO_NAME ?? props.eco_name ?? "Unknown"),
        biome_name: props.BIOME_NAME ?? props.biome_name ?? null,
        biome_num: props.BIOME_NUM != null ? Number(props.BIOME_NUM) : null,
        realm: props.REALM ?? props.realm ?? null,
        geometry_geojson: JSON.stringify(simplified),
      });
      count += 1;
    }
    if (batch.length >= 100) {
      flush(batch);
      batch = [];
    }
    result = await source.read();
  }
  if (batch.length > 0) flush(batch);

  db.exec(`CREATE INDEX idx_ecoregions_name ON ecoregions(eco_name)`);
  db.close();

  // Best-effort cleanup — on Windows, the shapefile reader's file handles can
  // take a moment to release, racing this rmSync. Not worth failing the
  // whole build over; the data is already safely written by this point.
  try {
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Could not remove temp dir ${EXTRACT_DIR} (non-fatal): ${err.message}`);
  }

  console.log(`Wrote ${count} ecoregions to ${DB_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
