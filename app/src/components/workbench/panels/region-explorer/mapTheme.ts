import type { StyleSpecification } from "maplibre-gl";

// Recolors the OpenFreeMap "positron" base style to this app's palette —
// ported from the design prototype (prototypes/map-view-phase0-darjeeling.html)
// so the real Map tab matches the validated design instead of stock
// OpenFreeMap grays.
export const MAP_THEME = {
  background: "#6cbd63",
  grass: "#4f9f50",
  forest: "#1f4a24",
  barren: "#e0cd9e",
  pitchTurf: "#5cae4a",
  water: "#2a86bd",
  waterOutline: "#1a5c82",
  residential: "#d9a98a",
  building: "#bf5a42",
  buildingOutline: "#8a3d2c",
  road: "#f7eecd",
  roadCasing: "#c2a462",
  roadMajor: "#d9d2ba",
  roadMajorCasing: "#96876a",
  adminBoundary: "#cec296",
} as const;

/** Mutates and returns `style` with this app's theme colors applied to the known OpenFreeMap positron layer ids. */
export function applyMapTheme(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers) {
    const id = layer.id;
    const paint = (layer as { paint?: Record<string, unknown> }).paint;
    const setPaint = (key: string, value: string) => {
      if (paint) paint[key] = value;
    };

    if (layer.type === "background") {
      setPaint("background-color", MAP_THEME.background);
    } else if (id === "landcover_wood") {
      setPaint("fill-color", MAP_THEME.forest);
    } else if (id === "landcover_grass" || id === "park") {
      setPaint("fill-color", MAP_THEME.grass);
    } else if (id === "park_outline") {
      setPaint("line-color", MAP_THEME.forest);
    } else if (id === "landcover_sand") {
      setPaint("fill-color", MAP_THEME.barren);
    } else if (id === "landcover_ice") {
      setPaint("fill-color", "#eef0e6");
    } else if (id === "landuse_residential") {
      setPaint("fill-color", MAP_THEME.residential);
      // Stock style caps this at maxzoom 12 while `building` only starts at
      // 13 — removing the cap avoids a blank gap between the two.
      delete (layer as { maxzoom?: number }).maxzoom;
    } else if (id === "landuse_pitch" || id === "landuse_track") {
      setPaint("fill-color", MAP_THEME.pitchTurf);
    } else if (id?.indexOf("landuse_") === 0) {
      setPaint("fill-color", MAP_THEME.residential);
    } else if (id === "water") {
      setPaint("fill-color", MAP_THEME.water);
      setPaint("fill-outline-color", MAP_THEME.waterOutline);
    } else if (layer["source-layer"] === "waterway" && paint && "line-color" in paint) {
      setPaint("line-color", MAP_THEME.water);
    } else if (id === "building") {
      setPaint("fill-color", MAP_THEME.building);
      setPaint("fill-outline-color", MAP_THEME.buildingOutline);
    } else if (id === "building-3d") {
      setPaint("fill-extrusion-color", MAP_THEME.building);
    } else if (layer["source-layer"] === "transportation" && layer.type === "line") {
      const major = /motorway|trunk_primary/.test(id);
      const casing = id.indexOf("_casing") !== -1;
      const isRail = /rail/.test(id);
      if (!isRail && paint && "line-color" in paint) {
        setPaint("line-color", casing ? (major ? MAP_THEME.roadMajorCasing : MAP_THEME.roadCasing) : major ? MAP_THEME.roadMajor : MAP_THEME.road);
      }
    } else if (id === "boundary_2" || id === "boundary_3" || id === "boundary_disputed") {
      setPaint("line-color", MAP_THEME.adminBoundary);
    }
  }
  return style;
}
