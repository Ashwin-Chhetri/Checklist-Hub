// Per-layer "download for QGIS" exports. Ported from the design prototype
// (prototypes/map-view-phase0-darjeeling.html) — Water Bodies exports as
// vector (GeoJSON + KML, zipped); NDVI and Vegetation/Land Cover are raster
// WMS overlays, so they export as a fresh full-bbox PNG plus a world file
// (.pgw) + .prj, zipped — QGIS opens a PNG+world-file pair as a georeferenced
// raster with no GeoTIFF conversion needed.
//
// Kept as GeoJSON/KML/PNG rather than a true ESRI Shapefile — hand-rolling
// the binary .shp/.shx/.dbf format is real added surface, and GeoJSON already
// opens in QGIS at least as cleanly (no 10-char field-name truncation).

import JSZip from "jszip";
import type { Bbox } from "./overpassApi";
import { MAP_THEME } from "./mapTheme";
import { WORLDCOVER_WMS_BASE, WORLDCOVER_LAYER, WORLDCOVER_TIME, ndviDateString } from "./regionStats";

export function slugify(s: string): string {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "region"
  );
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// EPSG:4326 WKT1 — the same string GDAL writes into a shapefile's .prj — lets
// QGIS auto-detect the CRS on import instead of prompting for it.
const WGS84_PRJ_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

/** World-file math for a north-up image spanning `bbox` at `width`x`height` pixels. */
function buildWorldFile(bbox: Bbox, width: number, height: number): string {
  const pixelSizeX = (bbox.maxLng - bbox.minLng) / width;
  const pixelSizeY = -(bbox.maxLat - bbox.minLat) / height;
  const originX = bbox.minLng + pixelSizeX / 2;
  const originY = bbox.maxLat + pixelSizeY / 2;
  return [pixelSizeX, 0, 0, pixelSizeY, originX, originY].map((n) => n.toFixed(12)).join("\n") + "\n";
}

function hexToKmlColor(hex: string, alphaHex = "ff"): string {
  const h = hex.replace("#", "");
  return alphaHex + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); // KML color order is aabbggrr
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function coordStr(coords: number[][]): string {
  return coords.map((pt) => `${pt[0]},${pt[1]},0`).join(" ");
}

function polygonKml(rings: number[][][]): string {
  const outer = `<outerBoundaryIs><LinearRing><coordinates>${coordStr(rings[0])}</coordinates></LinearRing></outerBoundaryIs>`;
  const inner = rings
    .slice(1)
    .map((r) => `<innerBoundaryIs><LinearRing><coordinates>${coordStr(r)}</coordinates></LinearRing></innerBoundaryIs>`)
    .join("");
  return `<Polygon><tessellate>1</tessellate>${outer}${inner}</Polygon>`;
}

function geometryKml(geom: GeoJSON.Geometry | undefined | null): string {
  if (!geom) return "";
  if (geom.type === "Polygon") return polygonKml(geom.coordinates as number[][][]);
  if (geom.type === "MultiPolygon") return `<MultiGeometry>${(geom.coordinates as number[][][][]).map(polygonKml).join("")}</MultiGeometry>`;
  if (geom.type === "LineString") return `<LineString><tessellate>1</tessellate><coordinates>${coordStr(geom.coordinates as number[][])}</coordinates></LineString>`;
  if (geom.type === "MultiLineString") {
    return `<MultiGeometry>${(geom.coordinates as number[][][])
      .map((l) => `<LineString><tessellate>1</tessellate><coordinates>${coordStr(l)}</coordinates></LineString>`)
      .join("")}</MultiGeometry>`;
  }
  return "";
}

/** Minimal GeoJSON -> KML 2.2 converter covering Polygon/MultiPolygon (with holes) and LineString/MultiLineString — enough for the water-bodies layer, not a general-purpose library. */
function geojsonToKml(fc: GeoJSON.FeatureCollection, opts: { name: string; styles?: string[] }): string {
  const placemarks = fc.features
    .map((f, i) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const kind = typeof props.kind === "string" ? props.kind : null;
      const name = (typeof props.name === "string" && props.name) || (kind ? `${kind} ${i + 1}` : `Feature ${i + 1}`);
      const styleUrl = kind ? `<styleUrl>#${kind}Style</styleUrl>` : "";
      return `<Placemark><name>${esc(name)}</name>${styleUrl}${geometryKml(f.geometry)}</Placemark>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(opts.name)}</name>` +
    `${(opts.styles ?? []).join("")}${placemarks}</Document></kml>`
  );
}

/** Wraps the region's own boundary geometry (not a data layer) as GeoJSON + KML for QGIS — same zip pattern as the water-bodies export above. */
export async function downloadRegionBoundaryForQgis(boundary: GeoJSON.Geometry, regionLabel: string, regionSlug: string): Promise<void> {
  const base = `${regionSlug}-boundary`;
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: boundary, properties: { name: regionLabel } }],
  };
  const zip = new JSZip();
  zip.file(`${base}.geojson`, JSON.stringify(fc, null, 2));
  zip.file(`${base}.kml`, geojsonToKml(fc, { name: `${regionLabel} — Region Boundary` }));
  zip.file(`${base}.prj`, WGS84_PRJ_WKT);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(blob, `${base}-qgis.zip`);
}

export async function downloadWaterBodiesForQgis(geojson: GeoJSON.FeatureCollection, regionLabel: string, regionSlug: string): Promise<void> {
  const base = `${regionSlug}-water-bodies`;
  const styles = [
    `<Style id="lakeStyle"><LineStyle><color>${hexToKmlColor(MAP_THEME.waterOutline)}</color><width>1</width></LineStyle><PolyStyle><color>${hexToKmlColor(MAP_THEME.water, "8c")}</color></PolyStyle></Style>`,
    `<Style id="riverStyle"><LineStyle><color>${hexToKmlColor(MAP_THEME.waterOutline)}</color><width>2</width></LineStyle></Style>`,
  ];
  const zip = new JSZip();
  zip.file(`${base}.geojson`, JSON.stringify(geojson, null, 2));
  zip.file(`${base}.kml`, geojsonToKml(geojson, { name: `${regionLabel} — Water Bodies`, styles }));
  const blob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(blob, `${base}-qgis.zip`);
}

/**
 * Fetches a fresh single-image WMS render of a raster layer across the whole
 * region bbox (not the tiled z/x/y scheme the map itself uses for display)
 * and packages it as PNG + world file (+ .prj) — a raster QGIS can load
 * directly ("Add Raster Layer") without any GeoTIFF conversion.
 */
export async function downloadRasterForQgis(bbox: Bbox, baseName: string, wmsUrlBuilder: (bbox: Bbox, width: number, height: number) => string, longSidePx = 1024): Promise<void> {
  const aspect = (bbox.maxLng - bbox.minLng) / (bbox.maxLat - bbox.minLat);
  const width = aspect >= 1 ? longSidePx : Math.max(1, Math.round(longSidePx * aspect));
  const height = aspect >= 1 ? Math.max(1, Math.round(longSidePx / aspect)) : longSidePx;

  const res = await fetch(wmsUrlBuilder(bbox, width, height));
  if (!res.ok) throw new Error(`Raster fetch failed: ${res.status}`);
  const imgBlob = await res.blob();

  const zip = new JSZip();
  zip.file(`${baseName}.png`, imgBlob);
  zip.file(`${baseName}.pgw`, buildWorldFile(bbox, width, height));
  zip.file(`${baseName}.prj`, WGS84_PRJ_WKT);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(zipBlob, `${baseName}-qgis.zip`);
}

export function ndviWmsUrl(bbox: Bbox, width: number, height: number): string {
  return (
    `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?service=WMS&version=1.3.0&request=GetMap&layers=MODIS_Terra_NDVI_8Day` +
    `&styles=&format=image/png&transparent=true&crs=EPSG:4326&time=${ndviDateString()}` +
    `&bbox=${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}&width=${width}&height=${height}`
  );
}

export function worldcoverWmsUrl(bbox: Bbox, width: number, height: number): string {
  return (
    `${WORLDCOVER_WMS_BASE}?service=WMS&version=1.3.0&request=GetMap&layers=${WORLDCOVER_LAYER}` +
    `&styles=&format=image/png&transparent=true&crs=EPSG:4326&time=${WORLDCOVER_TIME}` +
    `&bbox=${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}&width=${width}&height=${height}`
  );
}
