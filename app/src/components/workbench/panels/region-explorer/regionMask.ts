import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";

// MapLibre has no native "clip to polygon" primitive — the standard trick is
// a world-covering rectangle with the region's own ring(s) cut out as holes,
// painted above every data layer but below the boundary outline. Ported from
// the design prototype (prototypes/map-view-phase0-darjeeling.html).
function ringSignedArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum;
}

export function buildMaskGeometry(regionGeometry: BoundaryGeometry): BoundaryGeometry {
  const WORLD: number[][] = [
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
    // Force opposite winding from the world ring so it reads as a hole.
    return area * worldArea > 0 ? [...ring].reverse() : ring;
  });
  return { type: "Polygon", coordinates: [WORLD, ...holes] };
}

function isPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Sanity check for a mask built by buildMaskGeometry: a point genuinely
 * inside the source region must land inside the mask's hole (i.e. NOT be
 * covered by the world-minus-hole fill). This exists as a last line of
 * defense against a full-screen blank map — a mask that fails this check
 * (bad/degenerate cached geometry, a future regression, an edge case none
 * of the geometry tests caught) would otherwise paint solid over the ENTIRE
 * viewport with no visible symptom other than "nothing renders", since the
 * mask layer sits above every other layer by design. Callers should skip
 * adding the mask layer entirely when this returns false, trading "region
 * isn't clipped" for "region isn't blanked" — the far safer failure mode.
 */
export function maskExcludesPoint(mask: BoundaryGeometry, lng: number, lat: number): boolean {
  if (mask.type !== "Polygon") return false;
  const holes = mask.coordinates.slice(1);
  return holes.some((ring) => isPointInRing(lng, lat, ring));
}
