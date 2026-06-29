import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Derives a bounding box from a region's real boundary geometry (GADM
 * district polygon, OSM relation, or the last-resort Nominatim rectangle —
 * see `fetchRegionBoundary`). Preferred over asking the user to type
 * coordinates by hand: checklists are scoped to a real administrative
 * region via `region_gadm_id`/`region_osm_id`, so the boundary — and
 * therefore its bounding box — is already known, not something to guess.
 */
export function boundingBoxFromGeometry(geometry: BoundaryGeometry): BoundingBox {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  const visitRing = (ring: number[][]) => {
    for (const [lon, lat] of ring) {
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lon > east) east = lon;
      if (lon < west) west = lon;
    }
  };

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(visitRing);
  } else {
    geometry.coordinates.forEach((polygon) => polygon.forEach(visitRing));
  }

  return { north, south, east, west };
}
