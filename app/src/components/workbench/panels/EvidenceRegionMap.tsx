"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { boundaryBbox, type BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { applyMapTheme } from "./region-explorer/mapTheme";
import { buildMaskGeometry, maskExcludesPoint } from "./region-explorer/regionMask";
import type { OccurrencePoint } from "./RegionOccurrenceMap";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_CENTER: [number, number] = [0, 20];
const BRAND = "#c63939";

// Brand location-pin asset (public/checklisthub_location_pin.svg) — same
// icon used for the List tab's region badge (RegionHubBadge), so every
// occurrence marker across the app reads as the same mark. Natural size
// 24x28 with the tip at the bottom-center; PIN_WIDTH/HEIGHT below is that
// asset scaled down for this map's small thumbnail size.
const PIN_SRC = "/checklisthub_location_pin.svg";
const PIN_WIDTH = 14;
const PIN_HEIGHT = (PIN_WIDTH * 28) / 24;
const PIN_WIDTH_FOCUSED = 20;
const PIN_HEIGHT_FOCUSED = (PIN_WIDTH_FOCUSED * 28) / 24;

function isPointInRings(lng: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function flattenRings(geometry: BoundaryGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

interface EvidenceRegionMapProps {
  boundary: BoundaryGeometry | null;
  points: OccurrencePoint[];
  /** False when every source is unchecked — fades the boundary to signal
   * there's no currently-visible evidence tying the species to this region. */
  emphasizeBoundary?: boolean;
  /** True when `boundary` is a bounding-box rectangle (no real outline could
   * be resolved from either GADM or Nominatim) — rendered as a dashed,
   * clearly-approximate outline instead of a true region boundary. */
  isApproximate?: boolean;
  focusedKey?: string | null;
  onHoverPoint?: (key: string | null) => void;
  onClickPoint?: (point: OccurrencePoint) => void;
  /** True while occurrence points (and/or the boundary itself) are still
   * being fetched — shows a loading caption over the map instead of
   * implying "no data here". */
  isLoading?: boolean;
  heightClassName?: string;
}

/**
 * Real tiled MapLibre map for the Evidence tab's per-species occurrence
 * thumbnail — replaces the old flat hand-rolled SVG boundary renderer
 * (RegionOccurrenceMap, still used as MapListDialog's pre-data fallback).
 * A single instance is mounted at a time (Evidence tab shows one selected
 * species), so this can afford a real WebGL map unlike the List tab's
 * region badges (see RegionHubBadge's doc comment for why those stay
 * static). Deliberately lighter than the full Map tab (RegionExplorerMap):
 * no layers panel, protected areas, water bodies, NDVI/vegetation or
 * terrain — just the default basemap with the region boundary and
 * occurrence points plotted on it.
 */
export default function EvidenceRegionMap({
  boundary,
  points,
  emphasizeBoundary = true,
  isApproximate = false,
  focusedKey = null,
  onHoverPoint,
  onClickPoint,
  isLoading = false,
  heightClassName = "h-32",
}: EvidenceRegionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  const bbox = useMemo(() => (boundary ? boundaryBbox(boundary) : null), [boundary]);
  const rings = useMemo(() => (boundary ? flattenRings(boundary) : []), [boundary]);
  const outsideRegionCount = useMemo(
    () => (rings.length > 0 ? points.filter((p) => !isPointInRings(p.lng, p.lat, rings)).length : 0),
    [points, rings],
  );

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
          zoom: 1.5,
          attributionControl: false,
          cooperativeGestures: true,
        });
      } catch (err) {
        console.error("[EvidenceRegionMap] failed to construct map", err);
        setTileError("Failed to initialize the map (WebGL unavailable?).");
        return;
      }
      mapRef.current = map;
      map.on("error", (e) => {
        console.error("[EvidenceRegionMap]", e?.error?.message ?? e);
        setTileError("Failed to load map data.");
      });
      map.on("load", () => {
        if (!cancelled) setMapLoaded(true);
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
        console.error("[EvidenceRegionMap] failed to fetch/theme base style, falling back to stock style", err);
        startMap(OPENFREEMAP_STYLE);
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ---- Keep the map sized to its container ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ---- Boundary outline + mask + fit bounds ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !boundary || !bbox) return;

    const maskGeometry = buildMaskGeometry(boundary);
    // Cheap sanity point: bbox centroid. Good enough here (unlike the Map
    // tab's terrain/satellite layers, there's nothing catastrophic if a
    // concave region's centroid happens to fall just outside it — worst
    // case this skips the mask for one render).
    const testLng = (bbox.minLng + bbox.maxLng) / 2;
    const testLat = (bbox.minLat + bbox.maxLat) / 2;
    const maskIsSafe = maskExcludesPoint(maskGeometry, testLng, testLat) || isPointInRings(testLng, testLat, rings);

    if (!maskIsSafe) {
      if (map.getLayer("region-mask-layer")) map.removeLayer("region-mask-layer");
      if (map.getSource("region-mask")) map.removeSource("region-mask");
    } else {
      const maskSource = map.getSource("region-mask") as maplibregl.GeoJSONSource | undefined;
      if (maskSource) {
        maskSource.setData({ type: "Feature", geometry: maskGeometry, properties: {} });
      } else {
        map.addSource("region-mask", { type: "geojson", data: { type: "Feature", geometry: maskGeometry, properties: {} } });
        map.addLayer({ id: "region-mask-layer", type: "fill", source: "region-mask", paint: { "fill-color": "#f5f5f4", "fill-opacity": 0.85 } });
      }
    }

    const boundarySource = map.getSource("boundary") as maplibregl.GeoJSONSource | undefined;
    const lineColor = emphasizeBoundary ? BRAND : "#94a3b8";
    if (boundarySource) {
      boundarySource.setData({ type: "Feature", geometry: boundary, properties: {} });
    } else {
      map.addSource("boundary", { type: "geojson", data: { type: "Feature", geometry: boundary, properties: {} } });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        paint: { "line-color": lineColor, "line-width": 1.5, "line-dasharray": isApproximate ? [3, 2] : [1, 0] },
      });
    }
    if (map.getLayer("boundary-line")) {
      map.setPaintProperty("boundary-line", "line-color", lineColor);
      map.setPaintProperty("boundary-line", "line-dasharray", isApproximate ? [3, 2] : [1, 0]);
    }

    map.resize();
    map.fitBounds(
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      { padding: 16, duration: 0 },
    );
    requestAnimationFrame(() => map.resize());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, boundary, bbox, isApproximate, emphasizeBoundary]);

  // ---- Project occurrence points to screen pixels, kept in sync while the
  // user pans/zooms — recomputed on every camera move rather than only once,
  // since (unlike the boundary/mask) this map stays interactive. ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    function recompute() {
      const next = new Map<string, { x: number; y: number }>();
      for (const p of points) {
        const { x, y } = map!.project([p.lng, p.lat]);
        next.set(p.key, { x, y });
      }
      setPositions(next);
    }

    recompute();
    map.on("move", recompute);
    map.on("resize", recompute);
    return () => {
      map.off("move", recompute);
      map.off("resize", recompute);
    };
  }, [mapLoaded, points]);

  const showBoundaryFallback = !boundary && !isLoading;

  return (
    <div>
      <div className={`relative ${heightClassName} w-full border border-surface-dim bg-surface-container-low/30 overflow-hidden`}>
        <div ref={containerRef} className="absolute inset-0" />

        <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
          {points.map((p) => {
            const pos = positions.get(p.key);
            if (!pos) return null;
            const focused = focusedKey === p.key;
            const inside = rings.length === 0 || isPointInRings(p.lng, p.lat, rings);
            const w = focused ? PIN_WIDTH_FOCUSED : PIN_WIDTH;
            const h = focused ? PIN_HEIGHT_FOCUSED : PIN_HEIGHT;
            return (
              <image
                key={p.key}
                href={PIN_SRC}
                x={pos.x - w / 2}
                y={pos.y - h}
                width={w}
                height={h}
                opacity={inside ? 1 : 0.45}
                style={{ filter: inside ? undefined : "grayscale(1)", cursor: onClickPoint ? "pointer" : undefined }}
                className="pointer-events-auto"
                onPointerEnter={() => onHoverPoint?.(p.key)}
                onPointerLeave={() => onHoverPoint?.(null)}
                onClick={() => onClickPoint?.(p)}
              />
            );
          })}
        </svg>

        {(isLoading || !mapLoaded) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-surface-container-low/70">
            <span className="material-symbols-outlined text-brand text-[16px] animate-spin">progress_activity</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-widest mono-text">
              {isLoading ? "Loading occurrences…" : "Loading map…"}
            </span>
          </div>
        )}

        {showBoundaryFallback && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-container-low/70 text-[9px] text-slate-400 uppercase tracking-widest mono-text">
            No region boundary available
          </div>
        )}

        {tileError && (
          <div className="absolute top-1 left-1 right-1 z-10 bg-red-50 border border-red-200 text-red-700 rounded-sm px-2 py-1 text-[9px]">
            {tileError}
          </div>
        )}
      </div>
      {isApproximate && (
        <p className="mt-1 text-[8px] text-slate-400 uppercase tracking-widest mono-text">
          Approximate bounds — exact boundary unavailable
        </p>
      )}
      {outsideRegionCount > 0 && (
        <p className="mt-1 text-[8px] text-slate-400 uppercase tracking-widest mono-text">
          {outsideRegionCount} occurrence{outsideRegionCount === 1 ? "" : "s"} shown in grey fall outside this region
        </p>
      )}
    </div>
  );
}
