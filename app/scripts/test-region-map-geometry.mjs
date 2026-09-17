#!/usr/bin/env node
/**
 * Validates the two pieces of pure geometry the region Map/List tabs both
 * depend on — the "clip to region" mask (regionMask.ts's buildMaskGeometry,
 * what actually crops the Map tab's tiles to the region's real shape) and
 * the boundary->pixel projection (regionProjection.ts's buildBoundaryProjector,
 * shared by the Evidence tab's flat SVG map and the List tab's static hub
 * badge, and by the badge's WMS-image alignment) — against a table of
 * SYNTHETIC region shapes, not any one real district.
 *
 * Why synthetic rather than pulling from the real GADM mirror: that mirror
 * (app/data/gadm.sqlite, built by `npm run build:gadm`) needs a multi-GB
 * GeoPackage download most dev machines won't have handy, and the actual
 * bugs this guards against — inconsistent ring winding, concave shapes,
 * multi-polygon islands, high-latitude cos(lat) distortion — are properties
 * of the GEOMETRY, not of any specific district. A fixed set of deliberately
 * varied fixtures (see REGIONS below) exercises those properties directly,
 * runs instantly, and needs no setup — so this always runs, unlike
 * test-gadm-districts.mjs which hard-requires the sqlite mirror.
 *
 * If app/data/gadm.sqlite DOES exist locally, this also runs the same
 * checks against a random sample of real districts as a bonus pass (skipped,
 * not failed, if the file is missing).
 *
 * The functions below are intentionally small mirrors of the real
 * TypeScript source (buildMaskGeometry from regionMask.ts,
 * buildBoundaryProjector from regionProjection.ts) — same convention
 * test-gadm-districts.mjs already uses for gadm.js, since these scripts run
 * as plain Node ESM and the app has no TS-in-scripts runner configured. If
 * you change the real implementations, update these mirrors too.
 *
 * Usage:
 *   node scripts/test-region-map-geometry.mjs
 *   SAMPLE_SIZE=100 node scripts/test-region-map-geometry.mjs   (bonus GADM pass size)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const EPS = 1e-9;

// ---------------------------------------------------------------------
// Mirrors of regionMask.ts
// ---------------------------------------------------------------------

function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum;
}

function buildMaskGeometry(regionGeometry) {
  const WORLD = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const worldArea = ringSignedArea(WORLD);
  const exteriorRings = regionGeometry.type === "Polygon" ? [regionGeometry.coordinates[0]] : regionGeometry.coordinates.map((poly) => poly[0]);
  const holes = exteriorRings.map((ring) => {
    const area = ringSignedArea(ring);
    return area * worldArea > 0 ? [...ring].reverse() : ring;
  });
  return { type: "Polygon", coordinates: [WORLD, ...holes] };
}

// ---------------------------------------------------------------------
// Mirrors of regionProjection.ts
// ---------------------------------------------------------------------

function flattenToRings(geometry) {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function buildBoundaryProjector(rings, width, height, pad = 8) {
  const boundaryPoints = rings.flat();
  if (boundaryPoints.length === 0) return null;

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of boundaryPoints) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const spanLng = Math.max(maxLng - minLng, 0.0001);
  const spanLat = Math.max(maxLat - minLat, 0.0001);
  const meanLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lngScale = Math.cos(meanLatRad) || 1;
  const adjustedSpanLng = spanLng * lngScale;

  const availW = width - pad * 2;
  const availH = height - pad * 2;
  const scale = Math.min(availW / adjustedSpanLng, availH / spanLat);

  const offsetX = pad + (availW - adjustedSpanLng * scale) / 2;
  const offsetY = pad + (availH - spanLat * scale) / 2;

  const project = (lng, lat) => [offsetX + (lng - minLng) * lngScale * scale, offsetY + (maxLat - lat) * scale];

  return { project, minLng, maxLng, minLat, maxLat, adjustedSpanLng, spanLat, scale };
}

// Mirrors RegionHubBadge.tsx's imageBox derivation.
function buildImageBox(projector, bbox) {
  const [x0, y0] = projector.project(bbox.minLng, bbox.maxLat);
  const [x1, y1] = projector.project(bbox.maxLng, bbox.minLat);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---------------------------------------------------------------------
// Shared point-in-polygon (mirrors regionPointFilter.ts's isPointInRegion)
// ---------------------------------------------------------------------

function isPointInRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function bboxOf(rings) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

// ---------------------------------------------------------------------
// Synthetic fixture regions — deliberately varied, not one "test region"
// ---------------------------------------------------------------------

function rectRing(minLng, minLat, maxLng, maxLat) {
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
}

// A 6-point concave "arrow" shape — real districts are rarely convex.
function concaveRing(cx, cy, r) {
  const pts = [
    [cx - r, cy - r],
    [cx, cy - r * 0.2], // concave notch
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
  ];
  return [...pts, pts[0]];
}

const REGIONS = [
  {
    name: "equatorial square (convex, CCW)",
    geometry: { type: "Polygon", coordinates: [rectRing(10, -1, 12, 1)] },
    insidePoint: [11, 0],
    outsidePoint: [20, 0],
  },
  {
    name: "equatorial square, reversed winding (CW)",
    geometry: { type: "Polygon", coordinates: [[...rectRing(10, -1, 12, 1)].reverse()] },
    insidePoint: [11, 0],
    outsidePoint: [20, 0],
  },
  {
    name: "concave district (mimics a real coastline notch)",
    geometry: { type: "Polygon", coordinates: [concaveRing(50, 20, 3)] },
    insidePoint: [50, 21.5], // above the notch's apex — inside the rectangle-ish body
    outsidePoint: [50, 18], // below the notch's apex (19.4) — inside the carved-out bite, i.e. genuinely outside the ring
  },
  {
    name: "high-latitude district (~65N, strong cos(lat) distortion)",
    geometry: { type: "Polygon", coordinates: [rectRing(20, 64, 26, 66)] },
    insidePoint: [23, 65],
    outsidePoint: [23, 40],
  },
  {
    name: "southern-hemisphere district",
    geometry: { type: "Polygon", coordinates: [rectRing(140, -38, 145, -33)] },
    insidePoint: [142, -35],
    outsidePoint: [0, 0],
  },
  {
    name: "archipelago (MultiPolygon, 3 disjoint islands)",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [rectRing(100, 5, 101, 6)],
        [rectRing(103, 7, 104.2, 8.3)],
        [rectRing(98, 3, 98.6, 3.6)],
      ],
    },
    insidePoint: [103.5, 7.5],
    outsidePoint: [110, 10],
  },
  {
    name: "wide sliver (extreme aspect ratio, landscape)",
    geometry: { type: "Polygon", coordinates: [rectRing(0, 0, 40, 0.5)] },
    insidePoint: [20, 0.25],
    outsidePoint: [20, 10],
  },
  {
    name: "tall sliver (extreme aspect ratio, portrait)",
    geometry: { type: "Polygon", coordinates: [rectRing(0, 0, 0.5, 40)] },
    insidePoint: [0.25, 20],
    outsidePoint: [10, 20],
  },
  {
    name: "antimeridian-adjacent district (far east, not crossing 180)",
    geometry: { type: "Polygon", coordinates: [rectRing(178, -18, 179.5, -16)] },
    insidePoint: [178.7, -17],
    outsidePoint: [170, -17],
  },
];

// ---------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------

function checkMask(region) {
  const failures = [];
  const mask = buildMaskGeometry(region.geometry);

  if (mask.type !== "Polygon") failures.push(`mask type is "${mask.type}", expected "Polygon"`);
  const exteriorCount = region.geometry.type === "Polygon" ? 1 : region.geometry.coordinates.length;
  const holeCount = mask.coordinates.length - 1;
  if (holeCount !== exteriorCount) failures.push(`mask has ${holeCount} hole(s), expected ${exteriorCount}`);

  const worldRing = mask.coordinates[0];
  const worldArea = ringSignedArea(worldRing);
  for (let i = 1; i < mask.coordinates.length; i++) {
    const holeArea = ringSignedArea(mask.coordinates[i]);
    if (holeArea * worldArea > 0) failures.push(`hole #${i} has the same winding direction as the world ring (should be opposite, or it won't punch a hole)`);
  }

  // The whole point of the mask: a point truly inside the region must read
  // as "inside the hole" (i.e. cut out of the world fill), and a point
  // truly outside must NOT be cut out.
  const holeRings = mask.coordinates.slice(1);
  const [inLng, inLat] = region.insidePoint;
  const [outLng, outLat] = region.outsidePoint;
  if (!isPointInRings(inLng, inLat, holeRings)) failures.push(`known inside point [${inLng},${inLat}] does not land inside the mask's hole`);
  if (isPointInRings(outLng, outLat, holeRings)) failures.push(`known outside point [${outLng},${outLat}] incorrectly lands inside the mask's hole`);

  return failures;
}

function checkProjection(region) {
  const failures = [];
  const SIZE = 200;
  const PAD = 8;
  const rings = flattenToRings(region.geometry);
  const projector = buildBoundaryProjector(rings, SIZE, SIZE, PAD);
  if (!projector) {
    failures.push("projector returned null for a non-empty geometry");
    return failures;
  }

  // Every projected boundary vertex must land inside the viewBox.
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      const [x, y] = projector.project(lng, lat);
      if (x < -EPS || x > SIZE + EPS || y < -EPS || y > SIZE + EPS) {
        failures.push(`projected vertex (${x.toFixed(1)},${y.toFixed(1)}) falls outside the ${SIZE}x${SIZE} viewBox`);
        break;
      }
    }
  }

  // The WMS image box (RegionHubBadge) must be positive-sized, fit inside
  // the padded drawing area, and preserve the same cos(lat)-adjusted aspect
  // ratio the boundary path itself was projected with — otherwise the
  // raster would visibly stretch relative to the clip path drawn over it.
  const bbox = bboxOf(rings);
  const imageBox = buildImageBox(projector, bbox);
  if (!(imageBox.width > 0) || !(imageBox.height > 0)) {
    failures.push(`image box has non-positive size (${imageBox.width.toFixed(2)} x ${imageBox.height.toFixed(2)})`);
  } else {
    if (imageBox.x < PAD - EPS || imageBox.y < PAD - EPS || imageBox.x + imageBox.width > SIZE - PAD + EPS || imageBox.y + imageBox.height > SIZE - PAD + EPS) {
      failures.push(`image box (${imageBox.x.toFixed(1)},${imageBox.y.toFixed(1)} ${imageBox.width.toFixed(1)}x${imageBox.height.toFixed(1)}) overflows the padded ${SIZE}x${SIZE} viewBox`);
    }
    const expectedAspect = projector.adjustedSpanLng / projector.spanLat;
    const actualAspect = imageBox.width / imageBox.height;
    if (Math.abs(expectedAspect - actualAspect) / expectedAspect > 0.01) {
      failures.push(`image box aspect ${actualAspect.toFixed(3)} doesn't match the projector's own aspect ${expectedAspect.toFixed(3)} (raster would look stretched)`);
    }
  }

  return failures;
}

function runFixtureSuite(regions, label) {
  console.log(`\n${label} (${regions.length} regions)\n`);
  let passed = 0;
  const failures = [];
  for (const region of regions) {
    const rowFailures = [...checkMask(region), ...checkProjection(region)];
    if (rowFailures.length === 0) {
      passed++;
      console.log(`${GREEN}PASS${RESET} ${region.name}`);
    } else {
      failures.push({ name: region.name, rowFailures });
      console.log(`${RED}FAIL${RESET} ${region.name}`);
      for (const f of rowFailures) console.log(`     ${RED}${f}${RESET}`);
    }
  }
  console.log(`${DIM}${passed}/${regions.length} passed${RESET}`);
  return failures;
}

// ---------------------------------------------------------------------
// Optional bonus pass: real GADM districts, if the local mirror exists.
// ---------------------------------------------------------------------

function runGadmBonusPass() {
  const DB_PATH = process.env.GADM_DB_PATH || path.join(process.env.DATA_DIR || path.join(ROOT, "data"), "gadm.sqlite");
  if (!fs.existsSync(DB_PATH)) {
    console.log(`\n${YELLOW}Skipping bonus GADM pass — ${DB_PATH} not found (run \`npm run build:gadm\` to enable it).${RESET}`);
    return [];
  }
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const sampleSize = Number(process.env.SAMPLE_SIZE) > 0 ? Number(process.env.SAMPLE_SIZE) : 50;
  const rows = db
    .prepare(`SELECT gid, name, boundary_geojson FROM gadm_regions WHERE level = 2 AND boundary_geojson IS NOT NULL ORDER BY RANDOM() LIMIT ?`)
    .all(sampleSize);
  db.close();

  const regions = [];
  for (const row of rows) {
    let geometry;
    try {
      geometry = JSON.parse(row.boundary_geojson);
    } catch {
      continue;
    }
    const rings = flattenToRings(geometry);
    const bbox = bboxOf(rings);
    // Centroid of the bbox is a reasonable "probably inside" probe for a
    // real district; a point far outside its bbox is a reliable "outside".
    const insidePoint = isPointInRings((bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2, rings)
      ? [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2]
      : rings[0][0]; // fallback: a boundary vertex is trivially "inside enough" for the hole check below
    const outsidePoint = [bbox.minLng - (bbox.maxLng - bbox.minLng) - 5, bbox.minLat - (bbox.maxLat - bbox.minLat) - 5];
    regions.push({ name: `${row.name} (${row.gid})`, geometry, insidePoint, outsidePoint });
  }
  return runFixtureSuite(regions, "Bonus pass: real GADM districts, randomly sampled");
}

function main() {
  const syntheticFailures = runFixtureSuite(REGIONS, "Synthetic fixture regions (clip mask + projection alignment)");
  const gadmFailures = runGadmBonusPass();

  const totalFailures = syntheticFailures.length + gadmFailures.length;
  console.log(`\n${totalFailures === 0 ? GREEN : RED}${totalFailures === 0 ? "All checks passed" : `${totalFailures} region(s) failed`}${RESET}\n`);
  if (totalFailures > 0) process.exit(1);
}

main();
