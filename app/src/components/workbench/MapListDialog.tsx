"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useFamilyStats } from "@/modules/species/hooks/useFamilyStats";
import { useRegionBoundary } from "@/modules/checklist/hooks/useRegionBoundary";
import { boundaryBbox, type RegionBoundaryRequest } from "@/modules/checklist/services/regionApi";
import { prefetchRegionData } from "./panels/region-explorer/regionQueries";
import { slugify } from "./panels/region-explorer/regionExport";
import RegionOccurrenceMap from "./panels/RegionOccurrenceMap";
import FamilyListView from "./FamilyListView";
import CaptureCropOverlay from "./CaptureCropOverlay";
import type { ChecklistRegion } from "./SpeciesPanel";

// MapLibre GL needs a real browser/WebGL context — load it client-only, same
// pattern as the landing page's DotWorldMap (app/src/app/page.tsx).
const RegionExplorerMap = dynamic(() => import("./panels/region-explorer/RegionExplorerMap"), {
  ssr: false,
  loading: () => (
    <RegionOccurrenceMap boundary={null} points={[]} isLoading heightClassName="h-full" viewBoxWidth={480} viewBoxHeight={480} />
  ),
});

interface MapListDialogProps {
  checklistId: string;
  checklistTitle: string;
  region: ChecklistRegion;
  onClose: () => void;
}

// This dialog intentionally uses the design prototype's own palette
// (prototypes/map-view-phase0-darjeeling.html: --bg/--panel/--border/--ink/
// --brand) rather than the app's global red brand — a deliberate,
// self-contained look for this one feature, matched 1:1 to the validated
// design rather than the rest of Checklist Hub's chrome.
const PROTO = {
  bg: "#faf9f5",
  panel: "#ffffff",
  border: "#dcd9d0",
  ink: "#1c1c1a",
  inkDim: "#6b6a63",
  brand: "#1f6f43",
};

export default function MapListDialog({ checklistId, checklistTitle, region, onClose }: MapListDialogProps) {
  const [view, setView] = useState<"list" | "map">("list");
  const [captureOpen, setCaptureOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { families, isLoading: speciesLoading } = useFamilyStats(checklistId);
  const queryClient = useQueryClient();

  const boundaryRequest: RegionBoundaryRequest | null = useMemo(
    () =>
      (region.district && region.country) || region.gadmId || (region.osmType && region.osmId)
        ? { gadmId: region.gadmId, osmType: region.osmType, osmId: region.osmId, district: region.district, state: region.state, country: region.country }
        : null,
    [region.gadmId, region.osmType, region.osmId, region.district, region.state, region.country],
  );
  const boundaryQuery = useRegionBoundary(boundaryRequest);
  const boundary = boundaryQuery.data?.geometry ?? null;
  const bbox = useMemo(() => (boundary ? boundaryBbox(boundary) : null), [boundary]);

  // Kick off protected areas / water bodies / region stats fetches the
  // moment the dialog opens and the boundary resolves — regardless of
  // whether the List or Map tab is showing — so the Map tab (and a later
  // reopen of this same region, even after a page refresh thanks to the
  // sessionStorage-persisted query cache in QueryProvider) is instant
  // instead of waiting for the user to switch tabs.
  useEffect(() => {
    if (bbox) prefetchRegionData(queryClient, boundary, bbox, boundaryRequest);
  }, [queryClient, boundary, bbox, boundaryRequest]);

  // No visible close button — matches the design prototype (a standalone
  // page with no dialog chrome at all). Backdrop click already closes it;
  // Escape is added here purely for keyboard/screen-reader users.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !captureOpen) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, captureOpen]);

  const regionSlug = slugify(boundaryQuery.data?.name || region.name || "region");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-5" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Region & species map — ${checklistTitle}`}
        className="relative w-[92vw] max-w-[1180px] h-[85vh] max-h-[700px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* List/Map view toggle — sits directly on the card's top border,
            no gap, no bottom border — reads as an extension of the card's
            own corner radius rather than a separate floating chip. */}
        <div
          className="absolute left-[18px] bottom-full flex w-32 overflow-hidden rounded-t-md"
          style={{ border: `1px solid ${PROTO.border}`, borderBottom: "none", background: PROTO.panel }}
        >
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex-1 mono-text text-[11px] font-bold uppercase tracking-wider py-1.5 transition-colors"
            style={
              view === "list"
                ? { background: PROTO.brand, color: "#fff" }
                : { color: PROTO.inkDim, borderRight: `1px solid ${PROTO.border}` }
            }
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            className="flex-1 mono-text text-[11px] font-bold uppercase tracking-wider py-1.5 transition-colors"
            style={view === "map" ? { background: PROTO.brand, color: "#fff" } : { color: PROTO.inkDim }}
          >
            Map
          </button>
        </div>

        {/* Capture button — opens a snipping-tool overlay (CaptureCropOverlay)
            over the dialog card; drag to select a region or confirm with
            nothing selected to capture the whole card. */}
        <button
          type="button"
          onClick={() => setCaptureOpen(true)}
          title="Capture a snapshot of this view"
          className="absolute right-[18px] bottom-full w-8 h-[27px] flex items-center justify-center rounded-t-md hover:opacity-80"
          style={{
            border: `1px solid ${PROTO.border}`,
            borderBottom: "none",
            background: PROTO.panel,
            color: PROTO.ink,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
            <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
            <circle cx="12" cy="14" r="3.4" />
          </svg>
        </button>

        <div
          ref={cardRef}
          className="w-full h-full rounded-sm shadow-hard overflow-hidden flex flex-col"
          style={{ background: PROTO.panel, border: `1px solid ${PROTO.border}` }}
        >
          {view === "map" ? (
            <RegionExplorerMap
              boundary={boundary}
              isBoundaryApproximate={boundaryQuery.data?.source === "bbox"}
              isBoundaryLoading={boundaryQuery.isLoading}
              regionName={boundaryQuery.data?.name ?? region.name}
              boundaryRequest={boundaryRequest}
              heightClassName="h-full"
            />
          ) : speciesLoading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
              <span className="material-symbols-outlined text-[16px] animate-spin" style={{ color: PROTO.brand }}>
                progress_activity
              </span>
              Loading species…
            </div>
          ) : families.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[10px] uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
              No species in this checklist yet
            </div>
          ) : (
            <FamilyListView
              families={families}
              boundary={boundary}
              bbox={bbox}
              isBoundaryApproximate={boundaryQuery.data?.source === "bbox"}
              isBoundaryLoading={boundaryQuery.isLoading}
              regionName={boundaryQuery.data?.name ?? region.name}
              onOpenMap={() => setView("map")}
            />
          )}
        </div>
      </div>
      {captureOpen && <CaptureCropOverlay targetRef={cardRef} regionSlug={regionSlug} onClose={() => setCaptureOpen(false)} />}
    </div>
  );
}
