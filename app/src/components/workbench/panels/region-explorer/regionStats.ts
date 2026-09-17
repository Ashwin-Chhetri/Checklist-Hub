// Region summary stats (elevation, climate, dominant land cover) for the Map
// tab's Stats panel. Ported from the design prototype
// (prototypes/map-view-phase0-darjeeling.html: generateClippedGrid,
// fetchElevations, fetchAnnualMeanTemp, sampleDominantVegetation,
// nearestWorldCoverClass) — all keyless/open APIs, no server proxy needed.
//
// Unlike the prototype (hardcoded to Darjeeling's verified summit/lowest
// point), Highest/Lowest elevation here come from the same sampled grid as
// the mean — there's no per-region "true extremes" data source available for
// an arbitrary workbench region, so these are labeled as sampled values, not
// a verified peak/valley.

import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import type { Bbox } from "./overpassApi";

type LngLat = [number, number];

function flattenToRings(geometry: BoundaryGeometry): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.flat();
}

function pointInRings(lng: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

/** Grid of points spanning `bbox`, clipped to the region's actual rings — used for mean elevation, temperature-at-centroid, and dominant-vegetation sampling. Not meant to reliably land on true extremes (see file header). */
function generateClippedGrid(rings: number[][][], bbox: Bbox, targetPreClipCount: number, maxPoints: number): LngLat[] {
  const area = Math.max((bbox.maxLng - bbox.minLng) * (bbox.maxLat - bbox.minLat), 1e-6);
  const cell = Math.sqrt(area / targetPreClipCount);
  let pts: LngLat[] = [];
  for (let lat = bbox.minLat + cell / 2; lat <= bbox.maxLat; lat += cell) {
    for (let lng = bbox.minLng + cell / 2; lng <= bbox.maxLng; lng += cell) {
      if (pointInRings(lng, lat, rings)) pts.push([lng, lat]);
    }
  }
  if (pts.length > maxPoints) {
    const step = Math.ceil(pts.length / maxPoints);
    pts = pts.filter((_, i) => i % step === 0).slice(0, maxPoints);
  }
  return pts;
}

function polygonCentroid(bbox: Bbox): LngLat {
  return [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2];
}

/** Open-Meteo's elevation endpoint batches up to 100 points per request. */
async function fetchElevations(points: LngLat[]): Promise<number[]> {
  const chunkSize = 100;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    const lats = chunk.map((p) => p[1]).join(",");
    const lons = chunk.map((p) => p[0]).join(",");
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
    if (!res.ok) throw new Error(`Elevation API failed: ${res.status}`);
    const data = (await res.json()) as { elevation?: number[] };
    results.push(...(data.elevation ?? []));
  }
  return results;
}

interface AnnualMeanTemp {
  mean: number;
  year: number;
  sampleDays: number;
}

async function fetchAnnualMeanTemp(lat: number, lon: number): Promise<AnnualMeanTemp> {
  const lastFullYear = new Date().getUTCFullYear() - 1;
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${lastFullYear}-01-01&end_date=${lastFullYear}-12-31&daily=temperature_2m_mean&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Climate API failed: ${res.status}`);
  const data = (await res.json()) as { daily?: { temperature_2m_mean?: (number | null)[] } };
  const vals = (data.daily?.temperature_2m_mean ?? []).filter((v): v is number => v != null);
  if (!vals.length) throw new Error("No climate data returned");
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean, year: lastFullYear, sampleDays: vals.length };
}

// ---------- ESA WorldCover ----------
export const WORLDCOVER_WMS_BASE = "https://titiler.terrascope.be/wms";
export const WORLDCOVER_LAYER = "esa-worldcover-map-10m-2021-v2_map";
// Titiler only accepts WMS 1.3.0 (not 1.1.1) and requires an explicit TIME —
// confirmed live against the actual service. 1.3.0 + CRS=EPSG:4326 also uses
// strict OGC axis order (lat,lon), unlike 1.1.1's lon,lat.
export const WORLDCOVER_TIME = "2021-01-01";

export interface WorldCoverClass {
  code: number;
  label: string;
  color: string;
  rgb: [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const WORLDCOVER_PALETTE: WorldCoverClass[] = (
  [
    { code: 10, label: "Tree cover", color: "#006400" },
    { code: 20, label: "Shrubland", color: "#ffbb22" },
    { code: 30, label: "Grassland", color: "#ffff4c" },
    { code: 40, label: "Cropland", color: "#f096ff" },
    { code: 50, label: "Built-up", color: "#fa0000" },
    { code: 60, label: "Bare / sparse vegetation", color: "#b4b4b4" },
    { code: 70, label: "Snow and ice", color: "#f0f0f0" },
    { code: 80, label: "Permanent water bodies", color: "#0064c8" },
    { code: 90, label: "Herbaceous wetland", color: "#0096a0" },
    { code: 95, label: "Mangroves", color: "#00cf75" },
    { code: 100, label: "Moss and lichen", color: "#fae6a0" },
  ] as const
).map((c) => ({ ...c, rgb: hexToRgb(c.color) }));

function nearestWorldCoverClass(r: number, g: number, b: number): WorldCoverClass {
  let best = WORLDCOVER_PALETTE[0];
  let bestDist = Infinity;
  for (const c of WORLDCOVER_PALETTE) {
    const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

interface DominantVegetation {
  dominant: string | null;
  pct: number;
}

/** Fetches one WMS PNG of the region's bbox and tallies pixel colors at each grid point against WORLDCOVER_PALETTE — cheaper than fetching per-point, and titiler.terrascope.be sends permissive CORS headers so the pixels can be read back client-side. */
async function sampleDominantVegetation(bbox: Bbox, points: LngLat[]): Promise<DominantVegetation> {
  const W = 512;
  const H = 512;
  const url =
    `${WORLDCOVER_WMS_BASE}?service=WMS&version=1.3.0&request=GetMap&layers=${WORLDCOVER_LAYER}` +
    `&styles=&format=image/png&transparent=true&crs=EPSG:4326&time=${WORLDCOVER_TIME}` +
    `&bbox=${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}&width=${W}&height=${H}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("WorldCover sample image failed to load"));
    el.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch (e) {
    throw new Error(`Canvas pixel read blocked (CORS): ${(e as Error).message}`);
  }

  const tally: Record<string, number> = {};
  for (const [lng, lat] of points) {
    const px = Math.round(((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (W - 1));
    const py = Math.round(((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * (H - 1));
    const idx = (py * W + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a < 10) continue;
    const cls = nearestWorldCoverClass(r, g, b);
    tally[cls.label] = (tally[cls.label] ?? 0) + 1;
  }

  let dominant: string | null = null;
  let max = 0;
  let total = 0;
  for (const [label, count] of Object.entries(tally)) {
    total += count;
    if (count > max) {
      max = count;
      dominant = label;
    }
  }
  return { dominant, pct: total ? Math.round((max / total) * 100) : 0 };
}

// GIBS' NDVI composite lags — a fixed 12-day-old date is a safety margin the
// prototype validated against the real 8-day compositing schedule.
export function ndviDateString(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 12);
  return d.toISOString().slice(0, 10);
}

const GRID_TARGET_PRECLIP = 220;
const GRID_MAX_POINTS = 90;

export interface RegionStats {
  gridSampleCount: number;
  elevation: { minM: number; maxM: number; meanM: number } | null;
  climate: { meanTempC: number; year: number; sampleDays: number } | null;
  dominantVegetation: { label: string; pct: number } | null;
}

/**
 * One combined region-stats fetch (elevation extremes/mean, annual mean
 * temperature at the centroid, dominant land cover) — each sub-fetch is
 * independent and allowed to fail without failing the others, matching the
 * prototype's per-stat error handling; only a fully-empty result throws.
 */
export async function computeRegionStats(boundary: BoundaryGeometry, bbox: Bbox): Promise<RegionStats> {
  const rings = flattenToRings(boundary);
  const grid = rings.length ? generateClippedGrid(rings, bbox, GRID_TARGET_PRECLIP, GRID_MAX_POINTS) : [polygonCentroid(bbox)];
  const centroid = polygonCentroid(bbox);

  const [elevationResult, climateResult, vegetationResult] = await Promise.allSettled([
    fetchElevations(grid),
    fetchAnnualMeanTemp(centroid[1], centroid[0]),
    sampleDominantVegetation(bbox, grid),
  ]);

  let elevation: RegionStats["elevation"] = null;
  if (elevationResult.status === "fulfilled") {
    const valid = elevationResult.value.filter((v) => typeof v === "number" && isFinite(v));
    if (valid.length) {
      elevation = { minM: Math.round(Math.min(...valid)), maxM: Math.round(Math.max(...valid)), meanM: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) };
    }
  } else {
    console.error("[regionStats] elevation fetch failed", elevationResult.reason);
  }

  let climate: RegionStats["climate"] = null;
  if (climateResult.status === "fulfilled") {
    climate = { meanTempC: climateResult.value.mean, year: climateResult.value.year, sampleDays: climateResult.value.sampleDays };
  } else {
    console.error("[regionStats] climate fetch failed", climateResult.reason);
  }

  let dominantVegetation: RegionStats["dominantVegetation"] = null;
  if (vegetationResult.status === "fulfilled" && vegetationResult.value.dominant) {
    dominantVegetation = { label: vegetationResult.value.dominant, pct: vegetationResult.value.pct };
  } else if (vegetationResult.status === "rejected") {
    console.error("[regionStats] vegetation sample failed", vegetationResult.reason);
  }

  return { gridSampleCount: grid.length, elevation, climate, dominantVegetation };
}
