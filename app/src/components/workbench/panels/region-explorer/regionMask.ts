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
