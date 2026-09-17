"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useFamilyStats } from "@/modules/species/hooks/useFamilyStats";
import { useRegionBoundary } from "@/modules/checklist/hooks/useRegionBoundary";
import RegionOccurrenceMap from "./panels/RegionOccurrenceMap";
import FamilyListView from "./FamilyListView";
import type { ChecklistRegion } from "./SpeciesPanel";

// MapLibre GL needs a real browser/WebGL context — load it client-only, same
// pattern as the landing page's DotWorldMap (app/src/app/page.tsx).
const RegionExplorerMap = dynamic(() => import("./panels/region-explorer/RegionExplorerMap"), {
  ssr: false,
  loading: () => (
    <RegionOccurrenceMap boundary={null} points={[]} isLoading heightClassName="h-[440px]" viewBoxWidth={480} viewBoxHeight={480} />
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
  const { families, isLoading: speciesLoading } = useFamilyStats(checklistId);
  const boundaryQuery = useRegionBoundary(
    region.gadmId || (region.osmType && region.osmId)
      ? { gadmId: region.gadmId, osmType: region.osmType, osmId: region.osmId }
      : null,
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="rounded-sm shadow-hard max-w-[94vw] max-h-[88vh] overflow-y-auto transition-[width]"
        style={{ background: PROTO.panel, border: `1px solid ${PROTO.border}`, width: view === "map" ? 1160 : 760 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 pt-6 pb-3 sticky top-0 z-10"
          style={{ borderBottom: `1px solid ${PROTO.border}`, background: PROTO.panel }}
        >
          <div>
            <h3 className="mono-text text-sm font-bold uppercase tracking-wider" style={{ color: PROTO.ink }}>
              Region &amp; Species Map
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: PROTO.inkDim }}>
              {checklistTitle}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-sm overflow-hidden" style={{ border: `1px solid ${PROTO.border}` }}>
              <button
                type="button"
                onClick={() => setView("list")}
                className="mono-text text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors"
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
                className="mono-text text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors"
                style={view === "map" ? { background: PROTO.brand, color: "#fff" } : { color: PROTO.inkDim }}
              >
                Map
              </button>
            </div>
            <button onClick={onClose} className="hover:opacity-70" style={{ color: PROTO.inkDim }} title="Close">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="p-6" style={{ background: PROTO.bg }}>
          {view === "map" ? (
            <RegionExplorerMap
              boundary={boundaryQuery.data?.geometry ?? null}
              isBoundaryApproximate={boundaryQuery.data?.source === "bbox"}
              isBoundaryLoading={boundaryQuery.isLoading}
              regionName={boundaryQuery.data?.name ?? region.name}
              heightClassName="h-[440px]"
            />
          ) : speciesLoading ? (
            <div className="h-[440px] flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
              <span className="material-symbols-outlined text-[16px] animate-spin" style={{ color: PROTO.brand }}>
                progress_activity
              </span>
              Loading species…
            </div>
          ) : families.length === 0 ? (
            <div className="h-[440px] flex items-center justify-center text-[10px] uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
              No species in this checklist yet
            </div>
          ) : (
            <FamilyListView
              families={families}
              boundary={boundaryQuery.data?.geometry ?? null}
              isBoundaryApproximate={boundaryQuery.data?.source === "bbox"}
              isBoundaryLoading={boundaryQuery.isLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
