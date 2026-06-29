/**
 * Douglas-Peucker simplification of a single ring (array of [x,y]) — always
 * keeps the first/last point. Same algorithm as scripts/build-gadm.mjs's
 * `simplifyRing` (duplicated rather than shared: one runs as a plain Node
 * build script, the other inside the Next.js server runtime).
 */
export function simplifyRing(points: number[][], epsilon: number): number[][] {
  if (points.length <= 4) return points;

  function perpendicularDistance(p: number[], a: number[], b: number[]): number {
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

  function recurse(start: number, end: number) {
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

  const result: number[][] = [];
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

/** Default tolerance — small enough to keep a region's shape recognizable
 * at the workbench's small map size, large enough to cut a polygon's often
 * thousands of vertices down to a few hundred points at most. */
export const SIMPLIFY_EPSILON_DEG = 0.002;

/** Hard cap on points per ring after the epsilon pass — re-simplifies at a
 * coarser tolerance if a pathological polygon (e.g. a large country with a
 * very intricate coastline) is still too dense, so payload/cache row size
 * can't blow up. */
const MAX_POINTS_PER_RING = 2000;

export function simplifyRingWithCap(points: number[][], epsilon: number): number[][] {
  let result = simplifyRing(points, epsilon);
  let coarserEpsilon = epsilon;
  while (result.length > MAX_POINTS_PER_RING && coarserEpsilon < 1) {
    coarserEpsilon *= 4;
    result = simplifyRing(points, coarserEpsilon);
  }
  return result;
}

export type SimpleGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** Simplifies every ring of a Polygon/MultiPolygon geometry, applying the cap per ring. */
export function simplifyGeometry(geometry: SimpleGeometry, epsilon = SIMPLIFY_EPSILON_DEG): SimpleGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => simplifyRingWithCap(ring, epsilon)),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((rings) => rings.map((ring) => simplifyRingWithCap(ring, epsilon))),
  };
}
