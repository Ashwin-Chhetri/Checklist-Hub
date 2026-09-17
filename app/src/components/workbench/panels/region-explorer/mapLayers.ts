import type maplibregl from "maplibre-gl";
import type { Bbox } from "./overpassApi";
import { PROTECTED_AREA_CLASSES } from "./overpassApi";
import { MAP_THEME } from "./mapTheme";

export type BaseMapType = "default" | "satellite";

const SATELLITE_TILES = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];

// Green-black shadow / warm highlight so the relief texture blends into the
// theme's greens rather than sitting on top as generic gray. Ported from the
// design prototype.
const HILLSHADE_THEME = {
  shadow: "#16261a",
  highlight: "#f5edc9",
  accent: "#2e4a30",
  exaggeration: 0.6,
};

function boundsArray(bbox: Bbox): [number, number, number, number] {
  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
}

function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((l) => l.type === "symbol")?.id;
}

/**
 * Adds the satellite basemap raster + always-on hillshade relief, both
 * scoped to the region's own bbox so tiles for the rest of the world are
 * never requested. Idempotent — safe to call once per map instance after
 * the boundary/bbox is known.
 */
export function addBaseRasterLayers(map: maplibregl.Map, bbox: Bbox) {
  if (map.getSource("satellite")) return;
  const beforeId = firstSymbolLayerId(map);
  const bounds = boundsArray(bbox);

  map.addSource("satellite", {
    type: "raster",
    tiles: SATELLITE_TILES,
    tileSize: 256,
    maxzoom: 19,
    bounds,
    attribution: "Esri, Maxar, Earthstar Geographics",
  });
  map.addLayer({ id: "satellite-layer", type: "raster", source: "satellite", paint: { "raster-opacity": 1 }, layout: { visibility: "none" } }, beforeId);

  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: ["/api/regions/terrain-tile/{z}/{x}/{y}.png"],
    tileSize: 256,
    encoding: "terrarium",
    maxzoom: 15,
    bounds,
  });
  map.addLayer(
    {
      id: "hillshade-layer",
      type: "hillshade",
      source: "terrain-dem",
      paint: {
        "hillshade-exaggeration": HILLSHADE_THEME.exaggeration,
        "hillshade-shadow-color": HILLSHADE_THEME.shadow,
        "hillshade-highlight-color": HILLSHADE_THEME.highlight,
        "hillshade-accent-color": HILLSHADE_THEME.accent,
      },
      layout: { visibility: "visible" },
    },
    beforeId,
  );
}

export function setBaseMapType(map: maplibregl.Map, mapType: BaseMapType) {
  const satelliteOn = mapType === "satellite";
  if (map.getLayer("satellite-layer")) map.setLayoutProperty("satellite-layer", "visibility", satelliteOn ? "visible" : "none");
  if (map.getLayer("hillshade-layer")) map.setLayoutProperty("hillshade-layer", "visibility", satelliteOn ? "none" : "visible");
}

export function setTerrainEnabled(map: maplibregl.Map, enabled: boolean) {
  if (enabled) {
    map.setTerrain({ source: "terrain-dem", exaggeration: 1.5 });
    map.easeTo({ pitch: 60, duration: 600 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 600 });
  }
}

function addOrUpdateGeoJsonSource(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource(id, { type: "geojson", data });
  }
}

export function addProtectedAreasLayer(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection, visible: boolean) {
  addOrUpdateGeoJsonSource(map, "protected-areas", geojson);
  const vis = visible ? "visible" : "none";
  if (!map.getLayer("protected-areas-fill")) {
    const beforeId = firstSymbolLayerId(map);
    map.addLayer(
      { id: "protected-areas-fill", type: "fill", source: "protected-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 }, layout: { visibility: vis } },
      beforeId,
    );
    map.addLayer(
      { id: "protected-areas-line", type: "line", source: "protected-areas", paint: { "line-color": ["get", "color"], "line-width": 1.4 }, layout: { visibility: vis } },
      beforeId,
    );
  } else {
    map.setLayoutProperty("protected-areas-fill", "visibility", vis);
    map.setLayoutProperty("protected-areas-line", "visibility", vis);
  }
}

export function addWaterBodiesLayer(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection, visible: boolean) {
  addOrUpdateGeoJsonSource(map, "water-bodies", geojson);
  const vis = visible ? "visible" : "none";
  const polygonFilter: maplibregl.FilterSpecification = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]];
  if (!map.getLayer("water-fill")) {
    const beforeId = firstSymbolLayerId(map);
    map.addLayer(
      { id: "water-fill", type: "fill", source: "water-bodies", filter: polygonFilter, paint: { "fill-color": MAP_THEME.water, "fill-opacity": 0.55 }, layout: { visibility: vis } },
      beforeId,
    );
    map.addLayer(
      {
        id: "water-fill-outline",
        type: "line",
        source: "water-bodies",
        filter: polygonFilter,
        paint: { "line-color": MAP_THEME.waterOutline, "line-width": 1 },
        layout: { visibility: vis },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: "water-line",
        type: "line",
        source: "water-bodies",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": MAP_THEME.waterOutline, "line-width": 1.6 },
        layout: { visibility: vis },
      },
      beforeId,
    );
  } else {
    for (const id of ["water-fill", "water-fill-outline", "water-line"]) map.setLayoutProperty(id, "visibility", vis);
  }
}

export function setLayerVisibility(map: maplibregl.Map, ids: string[], visible: boolean) {
  const vis = visible ? "visible" : "none";
  for (const id of ids) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  }
}

export { PROTECTED_AREA_CLASSES };
