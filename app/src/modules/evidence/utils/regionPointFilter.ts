import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";

export type Ring = number[][];

export function flattenToRings(boundary: BoundaryGeometry): Ring[] {
  return boundary.type === "Polygon" ? boundary.coordinates : boundary.coordinates.flat();
}

/**
 * Exact point-in-region test via ray casting, accumulating crossings across
 * EVERY ring of every polygon with the even-odd rule — the same rule the
 * boundary `<path fillRule="evenodd">` uses to render, so a point only ever
 * counts as "inside" when it's inside the very shape that's drawn.
 */
export function isPointInRegion(lng: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}
