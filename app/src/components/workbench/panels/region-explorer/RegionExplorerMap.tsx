"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { boundaryBbox, type BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { applyMapTheme } from "./mapTheme";
import { buildMaskGeometry } from "./regionMask";

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

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    function startMap(style: StyleSpecification | string) {
      if (cancelled || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: FALLBACK_CENTER,
        zoom: 2,
        pitch: 0,
        maxPitch: 75,
        preserveDrawingBuffer: true, // needed later for the capture/screenshot tool
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
      map.on("error", (e) => console.error("[RegionExplorerMap]", e?.error?.message ?? e));
      map.on("load", () => {
        if (!cancelled) setMapLoaded(true);
      });
    }

    fetch(OPENFREEMAP_STYLE)
      .then((res) => res.json())
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
        paint: {
          "line-color": "#232323",
          "line-width": 2,
          "line-dasharray": isBoundaryApproximate ? [3, 2] : [1, 0],
        },
      });
    }
    if (map.getLayer("boundary-line")) {
      map.setPaintProperty("boundary-line", "line-dasharray", isBoundaryApproximate ? [3, 2] : [1, 0]);
    }

    const { minLng, maxLng, minLat, maxLat } = boundaryBbox(boundary);
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 24, duration: 0 },
    );
  }, [mapLoaded, boundary, isBoundaryApproximate]);

  const showLoading = isBoundaryLoading || !mapLoaded;

  return (
    <div className={`relative w-full ${heightClassName} rounded-sm overflow-hidden border border-surface-dim bg-[#faf9f5]`}>
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
    </div>
  );
}
