"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { boundaryBbox, type BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { applyMapTheme } from "./mapTheme";
import { buildMaskGeometry, maskExcludesPoint } from "./regionMask";
import { addBaseRasterLayers } from "./mapLayers";
import type { Bbox } from "./overpassApi";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_CENTER: [number, number] = [0, 20];

const PROTO = { bg: "#efece1", border: "#dcd9d0", ink: "#1c1c1a", inkDim: "#6b6a63", brand: "#1f6f43" };

// Occurrence point marker — the app's brand location-pin asset
// (public/checklisthub_location_pin.svg, natural size 24x28 with the tip at
// the bottom-center), same icon used for the Evidence tab's occurrence map
// (EvidenceRegionMap) so every marker across the app reads as the same mark.
const PIN_SRC = "/checklisthub_location_pin.svg";
const PIN_NATURAL_WIDTH = 24;
const PIN_NATURAL_HEIGHT = 28;
const PIN_TIP_X = 12;
const PIN_TIP_Y = 28;
// Rendered height in badge pixels — small enough not to blanket the badge
// when there are many points, still tall enough to read as a pin.
const PIN_RENDER_SIZE = 14;

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

interface RegionHubBadgeProps {
  boundary: BoundaryGeometry | null;
  bbox: Bbox | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
  regionName?: string | null;
  /** Jumps the parent dialog to the Map tab — the badge itself has no pan/
   * zoom (see `interactive: false` below), so "open the real thing" is its
   * only interaction. */
  onOpenMap?: () => void;
  /** Unused — kept so existing call sites don't need updating. */
  size?: number;
  /** Occurrence points for whichever taxon group is currently selected in
   * the List view's wheel/sidebar — plotted as pins clipped to the region
   * shape. Omitted (or empty) when nothing is selected. */
  points?: Array<{ key: number; lat: number; lng: number }>;
}

/**
 * A real (but non-interactive) MapLibre instance for the List tab's center
 * wheel — same Default style, hillshade relief and region mask/outline as
 * the actual Map tab's own default view, so this badge reads as a preview of
 * the real thing rather than a simplified stand-in. `interactive: false`
 * disables every built-in pan/zoom/rotate handler, so it behaves like a
 * static image (a click falls through to `onOpenMap`) while still being a
 * genuine MapLibre render underneath.
 *
 * This does mean a second WebGL context loads as soon as the dialog opens
 * (List is the default tab), not only once the user switches to Map — a
 * deliberate trade-off for visual parity with the real map. Each instance is
 * `map.remove()`-d on unmount (see the cleanup below), which releases its
 * WebGL context (`WEBGL_lose_context`), so this and the Map tab's own
 * instance are never both alive at once in practice — List unmounts this the
 * moment the user switches to the Map tab, same as the Map tab unmounts its
 * own instance switching back.
 */
export default function RegionHubBadge({
  boundary,
  bbox: bboxProp,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName,
  onOpenMap,
  points,
}: RegionHubBadgeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [positions, setPositions] = useState<Map<number, { x: number; y: number }>>(new Map());

  const bbox = useMemo(() => bboxProp ?? (boundary ? boundaryBbox(boundary) : null), [bboxProp, boundary]);
  const rings = useMemo(() => (boundary ? flattenRings(boundary) : []), [boundary]);

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
          interactive: false,
        });
      } catch (err) {
        console.error("[RegionHubBadge] failed to construct map", err);
        return;
      }
      mapRef.current = map;
      map.on("error", (e) => console.error("[RegionHubBadge]", e?.error?.message ?? e));
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
        console.error("[RegionHubBadge] failed to fetch/theme base style, falling back to stock style", err);
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
  const lastContainerSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    lastContainerSizeRef.current = { w: 0, h: 0 };
  }, [bbox]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const map = mapRef.current;
      if (!map) return;
      map.resize();
      // Same guard as the Map tab's own ResizeObserver (RegionExplorerMap.tsx)
      // — only re-fit while recovering from a collapsed/stale container size,
      // not on every reflow (e.g. the wheel re-rendering when the selected
      // taxon changes), which would otherwise fight this component's own
      // camera state for no reason.
      const rect = entries[0]?.contentRect;
      const wasCollapsed = lastContainerSizeRef.current.w < 40 || lastContainerSizeRef.current.h < 40;
      if (rect) lastContainerSizeRef.current = { w: rect.width, h: rect.height };
      if (bbox && wasCollapsed) {
        map.fitBounds(
          [
            [bbox.minLng, bbox.minLat],
            [bbox.maxLng, bbox.maxLat],
          ],
          { padding: 8, duration: 0 },
        );
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [bbox]);

  // ---- Boundary outline + mask + hillshade + fit bounds ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !boundary || !bbox) return;

    const maskGeometry = buildMaskGeometry(boundary);
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
        map.addLayer({ id: "region-mask-layer", type: "fill", source: "region-mask", paint: { "fill-color": PROTO.bg, "fill-opacity": 1 } });
      }
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
        paint: { "line-color": PROTO.ink, "line-width": 1.5, "line-dasharray": isBoundaryApproximate ? [3, 2] : [1, 0] },
      });
    }
    if (map.getLayer("boundary-line")) {
      map.setPaintProperty("boundary-line", "line-dasharray", isBoundaryApproximate ? [3, 2] : [1, 0]);
    }

    addBaseRasterLayers(map, bbox);

    map.resize();
    map.fitBounds(
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      { padding: 8, duration: 0 },
    );
    requestAnimationFrame(() => map.resize());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, boundary, bbox, isBoundaryApproximate]);

  // ---- Project occurrence points to screen pixels, kept in sync while the
  // camera settles (fitBounds/resize above) — mirrors EvidenceRegionMap. ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    function recompute() {
      const next = new Map<number, { x: number; y: number }>();
      for (const p of points ?? []) {
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

  const showLoading = isBoundaryLoading || !boundary;

  if (showLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: PROTO.bg }}>
        <span
          className="block w-4 h-4 rounded-full animate-spin"
          style={{ border: `2px solid ${PROTO.brand}`, borderTopColor: "transparent" }}
          aria-label="Loading region map…"
        />
      </div>
    );
  }

  const Wrapper = onOpenMap ? "button" : "div";

  return (
    <Wrapper
      type={onOpenMap ? "button" : undefined}
      onClick={onOpenMap}
      aria-label={onOpenMap ? `Open ${regionName ?? "region"} in Map view` : undefined}
      className="group relative w-full h-full block overflow-hidden"
      style={{ background: PROTO.bg, cursor: onOpenMap ? "pointer" : "default" }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        {(points ?? []).map((p) => {
          const pos = positions.get(p.key);
          if (!pos) return null;
          return (
            <g key={p.key} transform={`translate(${pos.x - PIN_TIP_X * (PIN_RENDER_SIZE / PIN_TIP_Y)}, ${pos.y - PIN_TIP_Y * (PIN_RENDER_SIZE / PIN_TIP_Y)}) scale(${PIN_RENDER_SIZE / PIN_TIP_Y})`}>
              <ellipse cx={PIN_TIP_X} cy={PIN_TIP_Y - 1.5} rx={4} ry={1.5} fill="#000000" opacity={0.28} />
              <image href={PIN_SRC} x={0} y={0} width={PIN_NATURAL_WIDTH} height={PIN_NATURAL_HEIGHT} />
            </g>
          );
        })}
      </svg>
      {onOpenMap && (
        <span
          className="absolute right-[14%] bottom-[14%] w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
          style={{ background: "#fff", border: `1px solid ${PROTO.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.28)", color: PROTO.ink }}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
            <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
          </svg>
        </span>
      )}
    </Wrapper>
  );
}
