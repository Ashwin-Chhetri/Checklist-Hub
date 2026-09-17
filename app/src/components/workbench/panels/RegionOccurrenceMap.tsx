"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { flattenToRings, isPointInRegion } from "@/modules/evidence/utils/regionPointFilter";
import { buildBoundaryProjector } from "@/modules/evidence/utils/regionProjection";

export type OccurrenceSource = "gbif" | "ebird" | "inaturalist";

export interface OccurrencePoint {
  key: string;
  source: OccurrenceSource;
  lat: number;
  lng: number;
  /** Destination when this point is clicked — the occurrence/observation's own page on its source site. */
  link: string;
}

interface RegionOccurrenceMapProps {
  boundary: BoundaryGeometry | null;
  points: OccurrencePoint[];
  /** False when every source is unchecked — fades the boundary to signal
   * there's no currently-visible evidence tying the species to this region. */
  emphasizeBoundary?: boolean;
  /** True when `boundary` is a bounding-box rectangle (no real outline could
   * be resolved from either GADM or Nominatim) — rendered as a dashed,
   * clearly-approximate shape instead of a true region outline. */
  isApproximate?: boolean;
  focusedKey?: string | null;
  onHoverPoint?: (key: string | null) => void;
  onClickPoint?: (point: OccurrencePoint) => void;
  /** True while occurrence points (and/or the boundary itself) are still
   * being fetched — shows a spinner instead of implying "no data here". */
  isLoading?: boolean;
  /** Tailwind height class for the map's box — defaults to the Evidence
   * panel's compact "h-32"; callers embedding this at a larger size (e.g. a
   * dedicated region-map dialog) can pass a taller class instead. The SVG's
   * own viewBox/projection is unaffected — only the rendered box grows. */
  heightClassName?: string;
  /** viewBox dimensions the boundary is projected into — defaults to the
   * Evidence panel's wide, short 320x128 box. A caller rendering this at a
   * much taller aspect (e.g. a full-size map dialog) should pass a squarer
   * viewBox too, or the region ends up letterboxed inside the old 2.5:1
   * shape instead of actually using the extra vertical room. */
  viewBoxWidth?: number;
  viewBoxHeight?: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 128;

const SOURCE_COLORS: Record<OccurrenceSource, { dot: string; focused: string }> = {
  gbif: { dot: "fill-red-500/80", focused: "fill-red-600" },
  ebird: { dot: "fill-blue-500/80", focused: "fill-blue-600" },
  inaturalist: { dot: "fill-green-500/80", focused: "fill-green-600" },
};

// Occurrences outside the region are still plotted (never silently dropped)
// but rendered in neutral grey so the in-region points read as the primary
// signal at a glance.
const OUTSIDE_REGION_DOT = "fill-slate-400/60";
const OUTSIDE_REGION_FOCUSED = "fill-slate-500";

// buildBoundaryProjector (shared with RegionHubBadge, see regionProjection.ts)
// is deliberately scaled from the BOUNDARY's own bounding box only — not the
// occurrence points'. A handful of imprecise/mistagged source records
// sitting far outside the region would otherwise stretch this box to fit
// them, shrinking the actual region down to a speck in the corner and making
// every *correctly*-placed point look like it's "outside" the region.

function MapSpinner({ label, heightClassName }: { label: string; heightClassName: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${heightClassName} border border-surface-dim bg-surface-container-low/40`}>
      <span className="material-symbols-outlined text-brand text-[16px] animate-spin">progress_activity</span>
      <span className="text-[9px] text-slate-400 uppercase tracking-widest mono-text">{label}</span>
    </div>
  );
}

export default function RegionOccurrenceMap({
  boundary,
  points,
  emphasizeBoundary = true,
  isApproximate = false,
  focusedKey = null,
  onHoverPoint,
  onClickPoint,
  isLoading = false,
  heightClassName = "h-32",
  viewBoxWidth = DEFAULT_WIDTH,
  viewBoxHeight = DEFAULT_HEIGHT,
}: RegionOccurrenceMapProps) {
  const rings = useMemo(() => (boundary ? flattenToRings(boundary) : []), [boundary]);
  const boundaryProjector = useMemo(
    () => buildBoundaryProjector(rings, viewBoxWidth, viewBoxHeight),
    [rings, viewBoxWidth, viewBoxHeight],
  );
  const outsideRegionCount = useMemo(
    () => (rings.length > 0 ? points.filter((p) => !isPointInRegion(p.lng, p.lat, rings)).length : 0),
    [points, rings],
  );

  if (!boundary || !boundaryProjector) {
    if (isLoading) return <MapSpinner label="Loading region map…" heightClassName={heightClassName} />;
    return (
      <div className={`${heightClassName} flex items-center justify-center border border-surface-dim bg-surface-container-low/40 text-[9px] text-slate-400 uppercase tracking-widest mono-text`}>
        No region boundary available
      </div>
    );
  }

  const project = boundaryProjector.project;
  const pathD = rings
    .map((ring) => {
      const cmds = ring.map(([lng, lat], i) => {
        const [x, y] = project(lng, lat);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return `${cmds.join(" ")} Z`;
    })
    .join(" ");

  return (
    <div>
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-surface-container-low/70">
            <span className="material-symbols-outlined text-brand text-[16px] animate-spin">progress_activity</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-widest mono-text">
              Loading occurrences…
            </span>
          </div>
        )}
        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className={`${heightClassName} w-full border border-surface-dim bg-surface-container-low/30`}
          preserveAspectRatio="xMidYMid meet"
        >
        <path
          d={pathD}
          fillRule="evenodd"
          className={emphasizeBoundary ? "fill-brand/10 stroke-brand/50" : "fill-slate-200/40 stroke-slate-300"}
          strokeWidth={1}
          strokeDasharray={isApproximate ? "3,2" : undefined}
        />
        {points.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const focused = focusedKey === p.key;
          const inside = rings.length === 0 || isPointInRegion(p.lng, p.lat, rings);
          const colors = SOURCE_COLORS[p.source];
          const fillClass = inside
            ? focused
              ? colors.focused
              : colors.dot
            : focused
              ? OUTSIDE_REGION_FOCUSED
              : OUTSIDE_REGION_DOT;
          return (
            <circle
              key={p.key}
              cx={x}
              cy={y}
              r={focused ? 3.5 : 2}
              className={focused ? `${fillClass} stroke-white` : fillClass}
              strokeWidth={focused ? 1 : 0}
              onPointerEnter={() => onHoverPoint?.(p.key)}
              onPointerLeave={() => onHoverPoint?.(null)}
              onClick={() => onClickPoint?.(p)}
              style={onClickPoint ? { cursor: "pointer" } : undefined}
            />
          );
        })}
        </svg>
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
