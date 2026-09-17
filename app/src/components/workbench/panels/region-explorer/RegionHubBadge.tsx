"use client";

import { useId, useMemo } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { flattenToRings } from "@/modules/evidence/utils/regionPointFilter";
import { buildBoundaryProjector } from "@/modules/evidence/utils/regionProjection";
import { MAP_THEME } from "./mapTheme";
import type { Bbox } from "./overpassApi";

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
// Rendered height in hub-badge SVG units — small enough not to blanket the
// badge when there are many points, still tall enough to read as a pin
// rather than a blob.
const PIN_RENDER_SIZE = 7;

interface RegionHubBadgeProps {
  boundary: BoundaryGeometry | null;
  bbox: Bbox | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
  regionName?: string | null;
  /** Jumps the parent dialog to the Map tab — this badge is a static
   * snapshot, not a live map, so "open the real thing" is its only
   * interaction. */
  onOpenMap?: () => void;
  /** ViewBox size in SVG units. */
  size?: number;
  /** Occurrence points for whichever taxon group is currently selected in
   * the List view's wheel/sidebar — plotted as small dots clipped to the
   * region shape. Omitted (or empty) when nothing is selected, in which
   * case the badge renders exactly as it always has. */
  points?: Array<{ key: number; lat: number; lng: number }>;
}

/**
 * Static, non-interactive stand-in for a live region map — used in the List
 * tab's center wheel, where a full second MapLibre instance would mean
 * loading the whole MapLibre GL bundle (and running a second WebGL context)
 * the instant the dialog opens, since List is the dialog's default tab.
 * Renders the region silhouette filled with the Map tab's own "Default"
 * theme background color (mapTheme.ts) — no raster fetch, no MapLibre, no
 * WebGL, nothing that can contend with the Map tab's own map instance since
 * the two never share any resource — and, critically, it reads as the same
 * view most people land on first when they open the real map (the Vegetation
 * layer this badge used to preview via a clipped ESA WorldCover raster
 * defaults off there).
 *
 * Deliberately a separate component from RegionOccurrenceMap (the Evidence
 * tab's flat SVG-only renderer) rather than a shared one — the two have
 * different jobs (click-through here; SVG boundary + occurrence dots there)
 * and keeping them apart means this work can't regress the Evidence tab's
 * renderer at all.
 */
export default function RegionHubBadge({
  boundary,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName,
  onOpenMap,
  size = 200,
  points,
}: RegionHubBadgeProps) {
  const rings = useMemo(() => (boundary ? flattenToRings(boundary) : []), [boundary]);
  const projector = useMemo(() => buildBoundaryProjector(rings, size, size), [rings, size]);

  const pathD = useMemo(() => {
    if (!projector) return "";
    return rings
      .map((ring) => {
        const cmds = ring.map(([lng, lat], i) => {
          const [x, y] = projector.project(lng, lat);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        });
        return `${cmds.join(" ")} Z`;
      })
      .join(" ");
  }, [rings, projector]);

  const clipId = `hub-clip-${useId()}`;
  const showLoading = isBoundaryLoading || !projector;

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
      className="group relative w-full h-full block"
      style={{ background: PROTO.bg, cursor: onOpenMap ? "pointer" : "default" }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full block" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={clipId}>
            <path d={pathD} fillRule="evenodd" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Solid fill matching the Map tab's own "Default" theme background
              (mapTheme.ts) — this badge used to render a clipped ESA
              WorldCover raster here, but that read as visually disconnected
              from the Default map view most people land on first. */}
          <rect x={0} y={0} width={size} height={size} fill={MAP_THEME.background} />
          {points?.map((p) => {
            const [x, y] = projector!.project(p.lng, p.lat);
            const scale = PIN_RENDER_SIZE / PIN_TIP_Y;
            return (
              <g key={p.key} transform={`translate(${x - PIN_TIP_X * scale}, ${y - PIN_TIP_Y * scale}) scale(${scale})`}>
                {/* Ground shadow — a plain soft ellipse under the tip, not an
                    SVG filter: with up to ~300 points on screen at once, a
                    real per-element blur filter would be far more expensive
                    to rasterize than one extra flat shape. */}
                <ellipse cx={PIN_TIP_X} cy={PIN_TIP_Y - 1.5} rx={4} ry={1.5} fill="#000000" opacity={0.28} />
                <image href={PIN_SRC} x={0} y={0} width={PIN_NATURAL_WIDTH} height={PIN_NATURAL_HEIGHT} />
              </g>
            );
          })}
        </g>
        <path
          d={pathD}
          fillRule="evenodd"
          fill="none"
          stroke={PROTO.ink}
          strokeWidth={1.5}
          strokeOpacity={0.55}
          strokeDasharray={isBoundaryApproximate ? "3,2" : undefined}
        />
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
