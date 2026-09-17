"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { boundaryBbox, type BoundaryGeometry, type RegionBoundaryRequest } from "@/modules/checklist/services/regionApi";
import { applyMapTheme } from "./mapTheme";
import { buildMaskGeometry } from "./regionMask";
import {
  addBaseRasterLayers,
  addProtectedAreasLayer,
  addWaterBodiesLayer,
  addNdviLayer,
  addVegetationLayer,
  setBaseMapType,
  setTerrainEnabled,
  type BaseMapType,
} from "./mapLayers";
import type { Bbox } from "./overpassApi";
import { useProtectedAreas, useWaterBodies, useRegionStats } from "./regionQueries";
import { createThreeDToggleControl, createRotateNudgeControl, type ThreeDToggleControl, type RotateNudgeControl } from "./mapControls";
import LayersPanel from "./LayersPanel";
import MapDetailsDialog from "./MapDetailsDialog";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_CENTER: [number, number] = [0, 20];

// Matches the design prototype's own palette
// (prototypes/map-view-phase0-darjeeling.html), not the app's global red
// brand — see MapListDialog.tsx for why.
const PROTO = {
  bg: "#faf9f5",
  panel: "#ffffff",
  border: "#dcd9d0",
  ink: "#1c1c1a",
  inkDim: "#6b6a63",
  brand: "#1f6f43",
};

interface RegionExplorerMapProps {
  boundary: BoundaryGeometry | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
  regionName?: string | null;
  /** Same identity used for useRegionBoundary — keys every overlay/stats query (regionQueries.ts) so a region's data shares one cache entry across dialog reopens and page refreshes. */
  boundaryRequest?: RegionBoundaryRequest | null;
  heightClassName?: string;
}

/**
 * Real tiled MapLibre map for the workbench's Map tab — replaces the flat
 * hand-rolled SVG boundary renderer (RegionOccurrenceMap, still used
 * elsewhere for the cheap per-species Evidence-tab thumbnail). Boundary
 * geometry is passed in (already resolved by useRegionBoundary) rather than
 * geocoded here, so the Map and List tabs never disagree.
 *
 * Protected areas / water bodies / region stats are fetched via shared
 * react-query hooks (regionQueries.ts) rather than local state — MapListDialog
 * prefetches these same queries as soon as the dialog opens (any tab), so by
 * the time this component mounts (user switches to the Map tab) the data is
 * usually already cached, and reopening the dialog or refreshing the page
 * (sessionStorage-persisted, see QueryProvider) skips the network entirely.
 */
export default function RegionExplorerMap({
  boundary,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName,
  boundaryRequest = null,
  heightClassName = "h-[440px]",
}: RegionExplorerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const threeDCtrlRef = useRef<ThreeDToggleControl | null>(null);
  const rotateCtrlRef = useRef<RotateNudgeControl | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [tilesRendered, setTilesRendered] = useState(false);

  const [baseMapType, setBaseMapTypeState] = useState<BaseMapType>("default");
  const [terrainEnabled, setTerrainEnabledState] = useState(false);
  const [showProtected, setShowProtected] = useState(true);
  const [showWater, setShowWater] = useState(true);
  const [showNdvi, setShowNdvi] = useState(false);
  const [showVegetation, setShowVegetation] = useState(false);
  const [legendOn, setLegendOn] = useState(true);
  const [mapDetailsOpen, setMapDetailsOpen] = useState(false);

  const bbox: Bbox | null = boundary ? boundaryBbox(boundary) : null;

  const protectedAreasQuery = useProtectedAreas(bbox, boundaryRequest);
  const waterBodiesQuery = useWaterBodies(bbox, boundaryRequest);
  const regionStatsQuery = useRegionStats(boundary, bbox, boundaryRequest);

  const protectedAreasCount = protectedAreasQuery.data ? protectedAreasQuery.data.features.length : protectedAreasQuery.isError ? 0 : null;
  const protectedAreaNames = protectedAreasQuery.data
    ? protectedAreasQuery.data.features.map((f) => (f.properties?.name as string | undefined) || "Protected area")
    : protectedAreasQuery.isError
      ? []
      : null;
  const waterBodiesCount = waterBodiesQuery.data ? waterBodiesQuery.data.features.length : waterBodiesQuery.isError ? 0 : null;
  const overlaysLoading = protectedAreasQuery.isLoading || waterBodiesQuery.isLoading;
  const regionStats = regionStatsQuery.data ?? null;
  const regionStatsLoading = regionStatsQuery.isLoading;

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
      // Stacked below the zoom/compass group by addControl's own ordering —
      // ported from the design prototype (ThreeDToggleControl/
      // RotateNudgeControl in map-view-phase0-darjeeling.html) since the
      // only built-in way to pitch/rotate is an undiscoverable ctrl+drag.
      const threeDCtrl = createThreeDToggleControl(() => setTerrainEnabledState((prev) => !prev));
      map.addControl(threeDCtrl, "top-right");
      threeDCtrlRef.current = threeDCtrl;
      const rotateCtrl = createRotateNudgeControl();
      map.addControl(rotateCtrl, "top-right");
      rotateCtrlRef.current = rotateCtrl;
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
      threeDCtrlRef.current = null;
      rotateCtrlRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ---- Keep the map correctly sized AND correctly framed whenever the
  // container's own box changes (dialog width transition between Map/List
  // tabs, window resize, etc.) — MapLibre doesn't catch either on its own
  // inside a modal. Re-fitting here (not just resizing) matters: if the very
  // first fitBounds call below ran while the dialog's open transition (or
  // the List<->Map tab swap, which unmounts/remounts this container) hadn't
  // finished sizing the container yet, MapLibre computes that fit from
  // whatever stale/zero transform size it had at that instant — a later
  // resize() alone fixes the canvas's pixel size but never recomputes the
  // camera, leaving it parked near the initial world view where the region
  // is a barely-visible speck and the cream "outside region" mask fills
  // almost the entire screen (reads as "nothing rendered"). A genuine
  // container resize (this observer's only trigger) never fires from the
  // user panning/zooming the map itself, so re-fitting here can't fight
  // their own navigation. ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      map.resize();
      if (bbox) {
        map.fitBounds(
          [
            [bbox.minLng, bbox.minLat],
            [bbox.maxLng, bbox.maxLat],
          ],
          { padding: 24, duration: 0 },
        );
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [bbox]);

  function fitToRegion() {
    const map = mapRef.current;
    if (!map || !bbox) return;
    map.fitBounds(
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      { padding: 24, duration: 400 },
    );
  }

  // ---- Boundary outline + mask + base/NDVI/vegetation raster layers + fit bounds ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !boundary || !bbox) return;

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

    addBaseRasterLayers(map, bbox);
    addNdviLayer(map, bbox);
    addVegetationLayer(map, bbox);
    setBaseMapType(map, baseMapType);

    // Resize BEFORE fitting, synchronously — fitBounds computes the camera
    // from whatever transform size the map currently has, and the
    // container (freshly mounted on every List<->Map tab swap) may not have
    // reported its true final size yet. Getting this order right here means
    // the very first frame is already correctly framed, rather than relying
    // solely on the ResizeObserver's correction above.
    map.resize();
    map.fitBounds(
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      { padding: 24, duration: 0 },
    );
    requestAnimationFrame(() => map.resize());
    // baseMapType intentionally omitted — handled by its own effect below so
    // switching Default/Satellite doesn't re-fit the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, boundary, bbox, isBoundaryApproximate]);

  // ---- Base map type / terrain toggles ----
  useEffect(() => {
    if (mapRef.current && mapLoaded) setBaseMapType(mapRef.current, baseMapType);
  }, [baseMapType, mapLoaded]);

  useEffect(() => {
    if (mapRef.current && mapLoaded) setTerrainEnabled(mapRef.current, terrainEnabled);
    // Keep the on-map 3D button + rotate-nudge buttons in sync regardless of
    // which control triggered the change (sidebar thumbnail or the on-map
    // button itself) — same pairing the prototype's setTerrainMode() does.
    threeDCtrlRef.current?.setActive(terrainEnabled);
    rotateCtrlRef.current?.setVisible(terrainEnabled);
  }, [terrainEnabled, mapLoaded]);

  // ---- Push protected areas / water bodies onto the map once fetched ----
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapLoaded && protectedAreasQuery.data) addProtectedAreasLayer(map, protectedAreasQuery.data, showProtected);
    // showProtected intentionally omitted — initial visibility only; later
    // toggles are applied directly by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, protectedAreasQuery.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapLoaded && waterBodiesQuery.data) addWaterBodiesLayer(map, waterBodiesQuery.data, showWater);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, waterBodiesQuery.data]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("ndvi-layer")) map.setLayoutProperty("ndvi-layer", "visibility", showNdvi ? "visible" : "none");
  }, [showNdvi]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("worldcover-layer")) map.setLayoutProperty("worldcover-layer", "visibility", showVegetation ? "visible" : "none");
  }, [showVegetation]);

  // "Map Legend (on-map icons)" toggle — hides all on-map chrome at once
  // (the built-in zoom/compass group + the scale control), matching the
  // design prototype's #map-wrap.legend-hidden behavior. The Fit-to-Region
  // button and status line are plain React elements, hidden directly below
  // instead of through this DOM query.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const container = map.getContainer();
    for (const selector of [".maplibregl-ctrl-top-right", ".maplibregl-ctrl-bottom-right", ".maplibregl-ctrl-bottom-left"]) {
      container.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.style.display = legendOn ? "" : "none";
      });
    }
  }, [legendOn, mapLoaded]);

  const showLoading = isBoundaryLoading || !mapLoaded;

  return (
    <div className="flex h-full w-full min-h-0">
      <div className={`relative flex-1 min-w-0 ${heightClassName}`} style={{ background: PROTO.bg }}>
        <div ref={containerRef} className="absolute inset-0" />
        {legendOn && mapLoaded && boundary && (
          <button
            type="button"
            onClick={fitToRegion}
            className="absolute top-2 left-2 z-10 mono-text text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-sm flex items-center gap-1.5 hover:opacity-80"
            style={{ background: PROTO.panel, border: `1px solid ${PROTO.border}`, color: PROTO.ink }}
          >
            <span aria-hidden="true">⤢</span>
            Fit to Region
          </button>
        )}
        {showLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest mono-text"
            style={{ background: PROTO.bg, color: PROTO.inkDim }}
          >
            <span className="material-symbols-outlined text-[16px] animate-spin" style={{ color: PROTO.brand }}>
              progress_activity
            </span>
            {isBoundaryLoading ? "Resolving region boundary…" : "Loading map…"}
          </div>
        )}
        {!showLoading && !boundary && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
            No region boundary available
          </div>
        )}
        {legendOn && !showLoading && boundary && (
          <div className="absolute bottom-2 left-2 mono-text text-[9px] uppercase tracking-widest" style={{ color: PROTO.inkDim }}>
            {isBoundaryApproximate ? `Approximate boundary${regionName ? ` — ${regionName}` : ""}` : regionName ? `Live — ${regionName}` : ""}
          </div>
        )}
        {tileError && (
          <div className="absolute top-2 left-2 right-2 bg-red-50 border border-red-200 text-red-700 rounded-sm px-2 py-1.5 text-[10px]">
            {tileError}
          </div>
        )}
        {mapLoaded && !tilesRendered && !tileError && (
          <div
            className="absolute bottom-2 right-2 rounded-sm px-2 py-1 text-[9px] uppercase tracking-widest mono-text"
            style={{ background: "rgba(255,255,255,0.9)", border: `1px solid ${PROTO.border}`, color: PROTO.inkDim }}
          >
            Waiting on map tiles…
          </div>
        )}
      </div>
      {mapLoaded && boundary && bbox && (
        <LayersPanel
          baseMapType={baseMapType}
          onBaseMapTypeChange={setBaseMapTypeState}
          terrainEnabled={terrainEnabled}
          onTerrainEnabledChange={setTerrainEnabledState}
          showProtected={showProtected}
          onShowProtectedChange={setShowProtected}
          showWater={showWater}
          onShowWaterChange={setShowWater}
          showNdvi={showNdvi}
          onShowNdviChange={setShowNdvi}
          showVegetation={showVegetation}
          onShowVegetationChange={setShowVegetation}
          protectedAreasCount={protectedAreasCount}
          protectedAreaNames={protectedAreaNames}
          waterBodiesCount={waterBodiesCount}
          waterBodiesGeoJSON={waterBodiesQuery.data ?? null}
          overlaysLoading={overlaysLoading}
          legendOn={legendOn}
          onLegendOnChange={setLegendOn}
          regionStats={regionStats}
          regionStatsLoading={regionStatsLoading}
          onOpenMapDetails={() => setMapDetailsOpen(true)}
          bbox={bbox}
          regionName={regionName ?? null}
        />
      )}
      <MapDetailsDialog open={mapDetailsOpen} onClose={() => setMapDetailsOpen(false)} sampleCount={regionStats?.gridSampleCount ?? null} />
    </div>
  );
}
