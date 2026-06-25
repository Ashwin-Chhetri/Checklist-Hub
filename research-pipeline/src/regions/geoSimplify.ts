/**
 * Douglas-Peucker simplification — ported verbatim from
 * ../app/src/lib/geo/simplify.ts (duplicated rather than imported across the
 * app/research-pipeline boundary by design; see README "Design notes").
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
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
  for (let i = 0; i < points.length; i++) if (keep[i]) result.push(points[i]);
  if (result.length < 4) {
    return points.length >= 4
      ? [points[0], points[Math.floor(points.length / 2)], points[points.length - 1], points[0]]
      : points;
  }
  return result;
}

export const SIMPLIFY_EPSILON_DEG = 0.002;
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

export function simplifyGeometry(geometry: SimpleGeometry, epsilon = SIMPLIFY_EPSILON_DEG): SimpleGeometry {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => simplifyRingWithCap(ring, epsilon)) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((rings) => rings.map((ring) => simplifyRingWithCap(ring, epsilon))),
  };
}
