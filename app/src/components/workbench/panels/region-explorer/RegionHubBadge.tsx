"use client";

import { useId, useMemo, useState } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { flattenToRings } from "@/modules/evidence/utils/regionPointFilter";
import { buildBoundaryProjector } from "@/modules/evidence/utils/regionProjection";
import { worldcoverWmsUrl } from "./regionExport";
import type { Bbox } from "./overpassApi";

const PROTO = { bg: "#efece1", border: "#dcd9d0", ink: "#1c1c1a", inkDim: "#6b6a63", brand: "#1f6f43" };

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
  /** ViewBox size in SVG units — also used, capped by devicePixelRatio, as
   * the requested WMS image's pixel size. Keep this modest: it directly
   * controls how much this badge costs to fetch and paint. */
  size?: number;
}

/**
 * Static, non-interactive stand-in for a live region map — used in the List
 * tab's center wheel, where a full second MapLibre instance would mean
 * loading the whole MapLibre GL bundle (and running a second WebGL context)
 * the instant the dialog opens, since List is the dialog's default tab. This
 * renders one clipped ESA WorldCover raster (the same keyless WMS source the
 * Map tab's Vegetation layer and Stats tab already use — see regionStats.ts)
 * instead: a single small PNG fetch, no MapLibre, no WebGL, nothing that can
 * contend with the Map tab's own map instance since the two never share any
 * resource.
 *
 * Clip-before-fetch, same principle as the Map tab's raster layers
 * (mapLayers.ts's `bounds` on every source): the WMS request itself is
 * already bounded to the region's own bbox — never the whole world — and
 * the SVG clipPath on top then hides the bbox rectangle's corners outside
 * the true region shape, mirroring the Map tab's "world rectangle with the
 * region cut out" mask technique.
 *
 * Deliberately a separate component from RegionOccurrenceMap (the Evidence
 * tab's flat SVG-only renderer) rather than a shared one — the two have
 * different jobs (image + click-through here; SVG boundary + occurrence dots
 * there) and keeping them apart means this work can't regress the Evidence
 * tab's renderer at all.
 */
export default function RegionHubBadge({
  boundary,
  bbox,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName,
  onOpenMap,
  size = 200,
}: RegionHubBadgeProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);

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

  // Maps the WMS image's own rectangular bbox into the exact same
  // cos(lat)-corrected pixel box the boundary path was projected into, so
  // the raster lines up with the clip path instead of looking stretched or
  // offset. See regionProjection.ts's doc comment for why this has to reuse
  // the same projector rather than a plain linear bbox->box scale.
  const imageBox = useMemo(() => {
    if (!projector || !bbox) return null;
    const [x0, y0] = projector.project(bbox.minLng, bbox.maxLat);
    const [x1, y1] = projector.project(bbox.maxLng, bbox.minLat);
    const width = x1 - x0;
    const height = y1 - y0;
    if (!(width > 0) || !(height > 0)) return null;
    return { x: x0, y: y0, width, height };
  }, [projector, bbox]);

  const imageHref = useMemo(() => {
    if (!bbox || !imageBox) return null;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const pxW = Math.max(1, Math.min(480, Math.round(imageBox.width * dpr)));
    const pxH = Math.max(1, Math.min(480, Math.round(imageBox.height * dpr)));
    return worldcoverWmsUrl(bbox, pxW, pxH);
  }, [bbox, imageBox]);

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
          <rect x={0} y={0} width={size} height={size} fill={PROTO.bg} />
          {imageHref && imageBox && !imgErrored && (
            <image
              href={imageHref}
              x={imageBox.x}
              y={imageBox.y}
              width={imageBox.width}
              height={imageBox.height}
              preserveAspectRatio="none"
              style={{ opacity: imgLoaded ? 1 : 0, transition: "opacity 0.2s ease" }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgErrored(true)}
            />
          )}
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
