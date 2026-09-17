// Direct client-side calls to the public Overpass API (OpenStreetMap query
// engine) — its interpreter sends permissive CORS headers, so unlike the
// AWS DEM tiles this needs no server-side proxy. Ported from the design
// prototype (prototypes/map-view-phase0-darjeeling.html), which validated
// this exact query/conversion approach against real regions.

const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export const PROTECTED_AREA_CLASSES: Record<string, { label: string; color: string }> = {
  "1a": { label: "Strict Nature Reserve", color: "#4a2361" },
  "1b": { label: "Wilderness Area", color: "#5b2a72" },
  "2": { label: "National Park", color: "#7a3d9c" },
  "3": { label: "Natural Monument", color: "#8f4aab" },
  "4": { label: "Habitat / Species Management (Wildlife Sanctuary)", color: "#a663bd" },
  "5": { label: "Protected Landscape / Seascape", color: "#bc84c9" },
  "6": { label: "Managed Resource Protected Area", color: "#c9a0d1" },
  other: { label: "Protected Area (unclassified)", color: "#9c7fa8" },
};

function protectedAreaStyle(protectClass: string) {
  return PROTECTED_AREA_CLASSES[protectClass] ?? PROTECTED_AREA_CLASSES.other;
}

type LngLat = [number, number];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function pointsEqual(a: LngLat, b: LngLat): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function isClosedRing(ring: LngLat[]): boolean {
  return ring.length > 2 && pointsEqual(ring[0], ring[ring.length - 1]);
}

/** Chains unordered way segments end-to-end into closed rings — the standard way OSM splits a large boundary relation into many short member ways. */
function assembleRings(segments: LngLat[][]): LngLat[][] {
  const remaining = segments.map((s) => s.slice());
  const rings: LngLat[][] = [];
  while (remaining.length) {
    let current = remaining.shift()!;
    let extended = true;
    while (extended && !isClosedRing(current)) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const segEnd = seg[seg.length - 1];
        if (pointsEqual(current[current.length - 1], seg[0])) {
          current = current.concat(seg.slice(1));
        } else if (pointsEqual(current[current.length - 1], segEnd)) {
          current = current.concat(seg.slice(0, -1).reverse());
        } else if (pointsEqual(current[0], segEnd)) {
          current = seg.slice(0, -1).concat(current);
        } else if (pointsEqual(current[0], seg[0])) {
          current = seg.slice(1).reverse().concat(current);
        } else {
          continue;
        }
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    rings.push(current);
  }
  return rings;
}

function buildWaysAndNodes(elements: OverpassElement[]) {
  const nodes: Record<number, LngLat> = {};
  const ways: Record<number, LngLat[]> = {};
  for (const el of elements) {
    if (el.type === "node" && el.lon != null && el.lat != null) nodes[el.id] = [el.lon, el.lat];
  }
  for (const el of elements) {
    if (el.type === "way" && el.nodes) {
      ways[el.id] = el.nodes.map((id) => nodes[id]).filter((p): p is LngLat => Boolean(p));
    }
  }
  return { nodes, ways };
}

function runOverpassQuery(query: string, label: string, mirrorIndex = 0): Promise<OverpassResponse> {
  if (mirrorIndex >= OVERPASS_MIRRORS.length) return Promise.reject(new Error("All Overpass mirrors failed"));
  const base = OVERPASS_MIRRORS[mirrorIndex];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  return fetch(`${base}?data=${encodeURIComponent(query)}`, { signal: controller.signal })
    .then((res) => {
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${base} returned ${res.status}`);
      return res.json() as Promise<OverpassResponse>;
    })
    .catch((err) => {
      clearTimeout(timer);
      console.warn(`[${label}] Overpass mirror failed:`, base, err);
      return runOverpassQuery(query, label, mirrorIndex + 1);
    });
}

export interface Bbox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

function protectedAreasToGeoJSON(json: OverpassResponse): GeoJSON.FeatureCollection {
  const { ways } = buildWaysAndNodes(json.elements);
  const features: GeoJSON.Feature[] = [];
  const usedAsRelationMember: Record<number, boolean> = {};

  for (const el of json.elements) {
    if (el.type !== "relation" || !el.members) continue;
    const tags = el.tags ?? {};
    const outerSegments: LngLat[][] = [];
    for (const m of el.members) {
      if (m.type !== "way" || !ways[m.ref]) continue;
      usedAsRelationMember[m.ref] = true;
      if (m.role !== "inner") outerSegments.push(ways[m.ref]);
    }
    const rings = assembleRings(outerSegments).filter(isClosedRing);
    if (!rings.length) continue;
    const style = protectedAreaStyle(tags.protect_class ?? "");
    features.push({
      type: "Feature",
      properties: { name: tags.name || tags.full_name || "Protected area", protectClass: tags.protect_class ?? null, color: style.color, label: style.label },
      geometry: rings.length === 1 ? { type: "Polygon", coordinates: [rings[0]] } : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
    });
  }

  for (const el of json.elements) {
    if (el.type !== "way" || !el.tags || usedAsRelationMember[el.id]) continue;
    const coords = ways[el.id];
    if (!coords || !isClosedRing(coords)) continue;
    const style = protectedAreaStyle(el.tags.protect_class ?? "");
    features.push({
      type: "Feature",
      properties: { name: el.tags.name || el.tags.full_name || "Protected area", protectClass: el.tags.protect_class ?? null, color: style.color, label: style.label },
      geometry: { type: "Polygon", coordinates: [coords] },
    });
  }

  return { type: "FeatureCollection", features };
}

export function fetchProtectedAreas(bbox: Bbox): Promise<GeoJSON.FeatureCollection> {
  const bboxStr = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const query =
    `[out:json][timeout:25];(` +
    `way["boundary"="protected_area"](${bboxStr});` +
    `way["boundary"="national_park"](${bboxStr});` +
    `way["leisure"="nature_reserve"](${bboxStr});` +
    `relation["boundary"="protected_area"](${bboxStr});` +
    `relation["boundary"="national_park"](${bboxStr});` +
    `relation["leisure"="nature_reserve"](${bboxStr});` +
    `);out body;>;out skel qt;`;
  return runOverpassQuery(query, "protected-areas").then(protectedAreasToGeoJSON);
}

function isWaterPolygonTags(tags: Record<string, string>): boolean {
  return tags.natural === "water" || tags.landuse === "reservoir" || Boolean(tags.water);
}

function waterBodiesToGeoJSON(json: OverpassResponse): GeoJSON.FeatureCollection {
  const { ways } = buildWaysAndNodes(json.elements);
  const features: GeoJSON.Feature[] = [];
  const usedAsRelationMember: Record<number, boolean> = {};

  for (const el of json.elements) {
    if (el.type !== "relation" || !el.members) continue;
    const tags = el.tags ?? {};
    if (!isWaterPolygonTags(tags)) continue;
    const outerSegments: LngLat[][] = [];
    const innerSegments: LngLat[][] = [];
    for (const m of el.members) {
      if (m.type !== "way" || !ways[m.ref]) continue;
      usedAsRelationMember[m.ref] = true;
      (m.role === "inner" ? innerSegments : outerSegments).push(ways[m.ref]);
    }
    const outerRings = assembleRings(outerSegments).filter(isClosedRing);
    if (!outerRings.length) continue;
    const innerRings = assembleRings(innerSegments).filter(isClosedRing);
    const rings = outerRings.concat(innerRings);
    features.push({
      type: "Feature",
      properties: { kind: "lake", name: tags.name ?? null },
      geometry: rings.length === 1 ? { type: "Polygon", coordinates: [rings[0]] } : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
    });
  }

  for (const el of json.elements) {
    if (el.type !== "way" || !el.tags || usedAsRelationMember[el.id]) continue;
    const coords = ways[el.id];
    if (!coords || coords.length < 2) continue;
    const tags = el.tags;
    if (isWaterPolygonTags(tags)) {
      const ring = isClosedRing(coords) ? coords : coords.concat([coords[0]]);
      if (ring.length < 4) continue;
      features.push({ type: "Feature", properties: { kind: "lake", name: tags.name ?? null }, geometry: { type: "Polygon", coordinates: [ring] } });
    } else {
      features.push({ type: "Feature", properties: { kind: "river", name: tags.name ?? null }, geometry: { type: "LineString", coordinates: coords } });
    }
  }

  return { type: "FeatureCollection", features };
}

export function fetchWaterBodies(bbox: Bbox): Promise<GeoJSON.FeatureCollection> {
  const bboxStr = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const query =
    `[out:json][timeout:25];(` +
    `way["waterway"~"^(river|stream|canal)$"](${bboxStr});` +
    `way["natural"="water"](${bboxStr});` +
    `way["landuse"="reservoir"](${bboxStr});` +
    `relation["natural"="water"](${bboxStr});` +
    `relation["landuse"="reservoir"](${bboxStr});` +
    `);out body;>;out skel qt;`;
  return runOverpassQuery(query, "water-bodies").then(waterBodiesToGeoJSON);
}
