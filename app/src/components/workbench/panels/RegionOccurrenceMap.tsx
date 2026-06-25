"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { flattenToRings, isPointInRegion, type Ring } from "@/modules/evidence/utils/regionPointFilter";

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
}

const WIDTH = 320;
const HEIGHT = 128;
const PAD = 8;

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

interface BoundaryProjector {
  project: (lng: number, lat: number) => [number, number];
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/**
 * Equirectangular fit-to-box projection, scaled from the BOUNDARY's own
 * bounding box only — deliberately not the occurrence points'. A handful of
 * imprecise/mistagged source records sitting far outside the region would
 * otherwise stretch this box to fit them, shrinking the actual region down
 * to a speck in the corner and making every *correctly*-placed point look
 * like it's "outside" the region. Longitude is corrected by cos(latitude) so
 * the shape isn't stretched away from its true aspect ratio.
 */
function buildBoundaryProjector(rings: Ring[]): BoundaryProjector | null {
  const boundaryPoints = rings.flat();
  if (boundaryPoints.length === 0) return null;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of boundaryPoints) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const spanLng = Math.max(maxLng - minLng, 0.0001);
  const spanLat = Math.max(maxLat - minLat, 0.0001);
  const meanLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lngScale = Math.cos(meanLatRad) || 1;
  const adjustedSpanLng = spanLng * lngScale;

  const availW = WIDTH - PAD * 2;
  const availH = HEIGHT - PAD * 2;
  const scale = Math.min(availW / adjustedSpanLng, availH / spanLat);

  const offsetX = PAD + (availW - adjustedSpanLng * scale) / 2;
  const offsetY = PAD + (availH - spanLat * scale) / 2;

  const project = (lng: number, lat: number): [number, number] => [
    offsetX + (lng - minLng) * lngScale * scale,
    offsetY + (maxLat - lat) * scale,
  ];

  return { project, minLng, maxLng, minLat, maxLat };
}

function MapSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 h-32 border border-surface-dim bg-surface-container-low/40">
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
}: RegionOccurrenceMapProps) {
  const rings = useMemo(() => (boundary ? flattenToRings(boundary) : []), [boundary]);
  const boundaryProjector = useMemo(() => buildBoundaryProjector(rings), [rings]);
  const outsideRegionCount = useMemo(
    () => (rings.length > 0 ? points.filter((p) => !isPointInRegion(p.lng, p.lat, rings)).length : 0),
    [points, rings],
  );

  if (!boundary || !boundaryProjector) {
    if (isLoading) return <MapSpinner label="Loading region map…" />;
    return (
      <div className="h-32 flex items-center justify-center border border-surface-dim bg-surface-container-low/40 text-[9px] text-slate-400 uppercase tracking-widest mono-text">
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
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-32 w-full border border-surface-dim bg-surface-container-low/30"
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
