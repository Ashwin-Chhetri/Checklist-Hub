"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { boundaryBbox, type BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { applyMapTheme } from "./mapTheme";
import { buildMaskGeometry } from "./regionMask";
import { addBaseRasterLayers, addProtectedAreasLayer, addWaterBodiesLayer, setBaseMapType, setTerrainEnabled, type BaseMapType } from "./mapLayers";
import { fetchProtectedAreas, fetchWaterBodies, type Bbox } from "./overpassApi";
import LayersPanel from "./LayersPanel";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_CENTER: [number, number] = [0, 20];

interface RegionExplorerMapProps {
  boundary: BoundaryGeometry | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
  regionName?: string | null;
  heightClassName?: string;
}

/**
 * Real tiled MapLibre map for the workbench's Map tab — replaces the flat
 * hand-rolled SVG boundary renderer (RegionOccurrenceMap, still used
 * elsewhere for the cheap per-species Evidence-tab thumbnail). Boundary
 * geometry is passed in (already resolved by useRegionBoundary) rather than
 * geocoded here, so the Map and List tabs never disagree.
 */
export default function RegionExplorerMap({
  boundary,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName,
  heightClassName = "h-[440px]",
}: RegionExplorerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [tilesRendered, setTilesRendered] = useState(false);

  const [baseMapType, setBaseMapTypeState] = useState<BaseMapType>("default");
  const [terrainEnabled, setTerrainEnabledState] = useState(false);
  const [showProtected, setShowProtected] = useState(true);
  const [showWater, setShowWater] = useState(true);
  const [protectedAreasCount, setProtectedAreasCount] = useState<number | null>(null);
  const [waterBodiesCount, setWaterBodiesCount] = useState<number | null>(null);
  const overlaysLoading = protectedAreasCount === null && waterBodiesCount === null;

  // ---- Map creation (once) ----
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    function startMap(style: StyleSpecification | string) {
      if (cancelled || !containerRef.current) return;
      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: FALLBACK_CENTER,
          zoom: 2,
          pitch: 0,
          maxPitch: 75,
          preserveDrawingBuffer: true, // needed later for the capture/screenshot tool
          attributionControl: false,
        });
      } catch (err) {
        console.error("[RegionExplorerMap] failed to construct map", err);
        setTileError("Failed to initialize the map (WebGL unavailable?).");
        return;
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
      map.on("error", (e) => {
        console.error("[RegionExplorerMap]", e?.error?.message ?? e);
        setTileError("Failed to load map data — check network access to tiles.openfreemap.org.");
      });
      map.on("sourcedata", (e) => {
        if (e.isSourceLoaded && !cancelled) setTilesRendered(true);
      });
      map.on("load", () => {
        if (!cancelled) setMapLoaded(true);
        // Defensive resize in case the container was measured mid-transition
        // (e.g. the dialog animating open) and got a stale 0-size reading.
        requestAnimationFrame(() => map.resize());
      });
    }

    fetch(OPENFREEMAP_STYLE)
      .then((res) => {
        if (!res.ok) throw new Error(`style fetch ${res.status}`);
        return res.json();
      })
      .then((style: StyleSpecification) => startMap(applyMapTheme(style)))
      .catch((err) => {
        console.error("[RegionExplorerMap] failed to fetch/theme base style, falling back to stock style", err);
        startMap(OPENFREEMAP_STYLE);
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ---- Keep the map correctly sized whenever the container's own box changes
  // (dialog width transition between Map/List tabs, window resize, etc.) —
  // MapLibre doesn't always catch this on its own inside a modal. ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ---- Boundary outline + mask + fit bounds ----
  const [bbox, setBbox] = useState<Bbox | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !boundary) return;

    const maskGeometry = buildMaskGeometry(boundary);
    const maskSource = map.getSource("region-mask") as maplibregl.GeoJSONSource | undefined;
    if (maskSource) {
      maskSource.setData({ type: "Feature", geometry: maskGeometry, properties: {} });
    } else {
      map.addSource("region-mask", { type: "geojson", data: { type: "Feature", geometry: maskGeometry, properties: {} } });
      map.addLayer({ id: "region-mask-layer", type: "fill", source: "region-mask", paint: { "fill-color": "#faf9f5", "fill-opacity": 1 } });
    }

    const boundarySource = map.getSource("boundary") as maplibregl.GeoJSONSource | undefined;
    if (boundarySource) {
      boundarySource.setData({ type: "Feature", geometry: boundary, properties: {} });
    } else {
      map.addSource("boundary", { type: "geojson", data: { type: "Feature", geometry: boundary, properties: {} } });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        paint: { "line-color": "#232323", "line-width": 2, "line-dasharray": isBoundaryApproximate ? [3, 2] : [1, 0] },
      });
    }
    if (map.getLayer("boundary-line")) {
      map.setPaintProperty("boundary-line", "line-dasharray", isBoundaryApproximate ? [3, 2] : [1, 0]);
    }

    const box = boundaryBbox(boundary);
    setBbox(box);
    addBaseRasterLayers(map, box);
    setBaseMapType(map, baseMapType);

    map.fitBounds(
      [
        [box.minLng, box.minLat],
        [box.maxLng, box.maxLat],
      ],
      { padding: 24, duration: 0 },
    );
    requestAnimationFrame(() => map.resize());
    // baseMapType intentionally omitted — handled by its own effect below so
    // switching Default/Satellite doesn't re-fit the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, boundary, isBoundaryApproximate]);

  // ---- Base map type / terrain toggles ----
  useEffect(() => {
    if (mapRef.current && mapLoaded) setBaseMapType(mapRef.current, baseMapType);
  }, [baseMapType, mapLoaded]);

  useEffect(() => {
    if (mapRef.current && mapLoaded) setTerrainEnabled(mapRef.current, terrainEnabled);
  }, [terrainEnabled, mapLoaded]);

  // ---- Fetch Protected Areas / Water Bodies once the bbox is known ----
  useEffect(() => {
    if (!bbox) return;
    let cancelled = false;
    Promise.allSettled([fetchProtectedAreas(bbox), fetchWaterBodies(bbox)]).then(([protectedResult, waterResult]) => {
      if (cancelled) return;
      const map = mapRef.current;
      if (protectedResult.status === "fulfilled") {
        setProtectedAreasCount(protectedResult.value.features.length);
        if (map) addProtectedAreasLayer(map, protectedResult.value, showProtected);
      } else {
        console.warn("[RegionExplorerMap] protected areas fetch failed", protectedResult.reason);
        setProtectedAreasCount(0);
      }
      if (waterResult.status === "fulfilled") {
        setWaterBodiesCount(waterResult.value.features.length);
        if (map) addWaterBodiesLayer(map, waterResult.value, showWater);
      } else {
        console.warn("[RegionExplorerMap] water bodies fetch failed", waterResult.reason);
        setWaterBodiesCount(0);
      }
    });
    return () => {
      cancelled = true;
    };
    // showProtected/showWater intentionally omitted — initial visibility only;
    // later toggles are applied directly by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("protected-areas-fill")) {
      map.setLayoutProperty("protected-areas-fill", "visibility", showProtected ? "visible" : "none");
      map.setLayoutProperty("protected-areas-line", "visibility", showProtected ? "visible" : "none");
    }
  }, [showProtected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("water-fill")) {
      const vis = showWater ? "visible" : "none";
      for (const id of ["water-fill", "water-fill-outline", "water-line"]) map.setLayoutProperty(id, "visibility", vis);
    }
  }, [showWater]);

  const showLoading = isBoundaryLoading || !mapLoaded;

  return (
    <div className="flex gap-4">
      <div className={`relative flex-1 min-w-0 ${heightClassName} rounded-sm overflow-hidden border border-surface-dim bg-[#faf9f5]`}>
        <div ref={containerRef} className="absolute inset-0" />
        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[#faf9f5] text-slate-400 text-[10px] uppercase tracking-widest mono-text">
            <span className="material-symbols-outlined text-brand text-[16px] animate-spin">progress_activity</span>
            {isBoundaryLoading ? "Resolving region boundary…" : "Loading map…"}
          </div>
        )}
        {!showLoading && !boundary && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-[10px] uppercase tracking-widest mono-text">
            No region boundary available
          </div>
        )}
        {!showLoading && isBoundaryApproximate && (
          <div className="absolute bottom-2 left-2 bg-white/90 border border-surface-dim rounded-sm px-2 py-1 text-[9px] text-slate-500 uppercase tracking-widest mono-text">
            Approximate boundary{regionName ? ` — ${regionName}` : ""}
          </div>
        )}
        {tileError && (
          <div className="absolute top-2 left-2 right-2 bg-red-50 border border-red-200 text-red-700 rounded-sm px-2 py-1.5 text-[10px]">
            {tileError}
          </div>
        )}
        {mapLoaded && !tilesRendered && !tileError && (
          <div className="absolute bottom-2 right-2 bg-white/90 border border-surface-dim rounded-sm px-2 py-1 text-[9px] text-slate-400 uppercase tracking-widest mono-text">
            Waiting on map tiles…
          </div>
        )}
      </div>
      {mapLoaded && boundary && (
        <LayersPanel
          baseMapType={baseMapType}
          onBaseMapTypeChange={setBaseMapTypeState}
          terrainEnabled={terrainEnabled}
          onTerrainEnabledChange={setTerrainEnabledState}
          showProtected={showProtected}
          onShowProtectedChange={setShowProtected}
          showWater={showWater}
          onShowWaterChange={setShowWater}
          protectedAreasCount={protectedAreasCount}
          waterBodiesCount={waterBodiesCount}
          overlaysLoading={overlaysLoading}
        />
      )}
    </div>
  );
}
