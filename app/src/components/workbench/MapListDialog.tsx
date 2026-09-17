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

export default function MapListDialog({ checklistId, checklistTitle, region, onClose }: MapListDialogProps) {
  const [view, setView] = useState<"map" | "list">("map");
  const { families, isLoading: speciesLoading } = useFamilyStats(checklistId);
  const boundaryQuery = useRegionBoundary(
    region.gadmId || (region.osmType && region.osmId)
      ? { gadmId: region.gadmId, osmType: region.osmType, osmId: region.osmId }
      : null,
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className={`bg-white border border-surface-dim rounded-sm shadow-hard max-w-[94vw] max-h-[88vh] overflow-y-auto transition-[width] ${
          view === "map" ? "w-[1040px]" : "w-[760px]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3 border-b border-surface-dim sticky top-0 bg-white z-10">
          <div>
            <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Region &amp; Species Map</h3>
            <p className="text-[11px] text-on-surface-variant mt-0.5">{checklistTitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-sm border border-outline overflow-hidden">
              <button
                type="button"
                onClick={() => setView("map")}
                className={`mono-text text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 ${
                  view === "map" ? "bg-brand text-white" : "text-on-surface-variant hover:text-brand"
                }`}
              >
                Map
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={`mono-text text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border-l border-outline ${
                  view === "list" ? "bg-brand text-white" : "text-on-surface-variant hover:text-brand"
                }`}
              >
                List
              </button>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-brand" title="Close">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="p-6">
          {view === "map" ? (
            <RegionExplorerMap
              boundary={boundaryQuery.data?.geometry ?? null}
              isBoundaryApproximate={boundaryQuery.data?.source === "bbox"}
              isBoundaryLoading={boundaryQuery.isLoading}
              regionName={boundaryQuery.data?.name ?? region.name}
              heightClassName="h-[440px]"
            />
          ) : speciesLoading ? (
            <div className="h-[440px] flex items-center justify-center gap-2 text-slate-400 text-[10px] uppercase tracking-widest mono-text">
              <span className="material-symbols-outlined text-brand text-[16px] animate-spin">progress_activity</span>
              Loading species…
            </div>
          ) : families.length === 0 ? (
            <div className="h-[440px] flex items-center justify-center text-slate-400 text-[10px] uppercase tracking-widest mono-text">
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
