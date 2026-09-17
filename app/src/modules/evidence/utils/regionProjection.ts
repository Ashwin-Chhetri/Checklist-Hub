import type { Ring } from "./regionPointFilter";

export interface BoundaryProjector {
  project: (lng: number, lat: number) => [number, number];
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/**
 * Equirectangular fit-to-box projection, scaled from the given rings' own
 * bounding box only. Longitude is corrected by cos(latitude) so the shape
 * isn't stretched away from its true aspect ratio — same technique a raster
 * clipped into this same box (e.g. RegionHubBadge's WMS image) must also use
 * to line up with the projected boundary path pixel-for-pixel.
 *
 * Extracted from RegionOccurrenceMap (which owned this logic alone until
 * RegionHubBadge needed the identical math for a second, non-SVG-path use)
 * — behavior is unchanged, just shared.
 */
export function buildBoundaryProjector(rings: Ring[], width: number, height: number, pad = 8): BoundaryProjector | null {
  const boundaryPoints = rings.flat();
  if (boundaryPoints.length === 0) return null;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
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

  const project = (lng: number, lat: number): [number, number] => [
    offsetX + (lng - minLng) * lngScale * scale,
    offsetY + (maxLat - lat) * scale,
  ];

  return { project, minLng, maxLng, minLat, maxLat };
}
