"use client";

import { useState } from "react";
import type { Checklist, TaxonomicScope } from "@/types/checklist.types";
import { useUpdateChecklist } from "@/modules/checklist/hooks/useChecklist";
import { RegionInput, type RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { TaxonomicScopeSelector } from "@/components/checklist-wizard/step1/TaxonomicScopeSelector";

interface SettingsModalProps {
  checklist: Checklist;
  checklistId: string;
  onClose: () => void;
}

const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

function scopePath(scope: TaxonomicScope): string {
  return RANKS.map((r) => scope[r]).filter((v): v is string => Boolean(v)).join(" › ");
}

function regionValueFromChecklist(checklist: Checklist): RegionValue {
  return {
    region_name: checklist.region_name ?? "",
    // Fall back to region_name so checklists missing region_district (e.g. older
    // data) still render the locked-in chip view instead of a blank search box.
    region_district: checklist.region_district ?? checklist.region_name ?? "",
    region_state: checklist.region_state ?? "",
    region_country: checklist.region_country ?? "",
    region_gadm_id: checklist.region_gadm_id ?? "",
    region_pin: checklist.region_pin ?? "",
    region_osm_type: checklist.region_osm_type ?? "",
    region_osm_id: checklist.region_osm_id ?? "",
  };
}

export default function SettingsModal({ checklist, checklistId, onClose }: SettingsModalProps) {
  const [title, setTitle] = useState(checklist.title);
  const [region, setRegion] = useState<RegionValue>(regionValueFromChecklist(checklist));
  const [taxonomicScope, setTaxonomicScope] = useState<TaxonomicScope>(checklist.taxonomic_scope ?? {});
  const updateChecklist = useUpdateChecklist(checklistId);

  function handleSave() {
    updateChecklist.mutate(
      {
        title: title.trim(),
        region_name: region.region_district.trim() || null,
        region_district: region.region_district.trim() || null,
        region_state: region.region_state.trim() || null,
        region_country: region.region_country.trim() || null,
        region_gadm_id: region.region_gadm_id.trim() || null,
        region_osm_type: region.region_osm_type?.trim() || null,
        region_osm_id: region.region_osm_id?.trim() || null,
        region_pin: region.region_pin?.trim() || null,
        taxonomic_scope: taxonomicScope,
      },
      { onSuccess: onClose },
    );
  }

  const currentScopePath = scopePath(taxonomicScope);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[680px] max-h-[88vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Checklist Settings</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="flex flex-col gap-lg">
          <div className="space-y-xs">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Title</label>
            <input
              className="w-full border border-surface-dim rounded-sm px-3 py-1.5 text-xs focus:border-brand focus:ring-0"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-xs">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Taxonomic Scope
              </label>
              {currentScopePath && (
                <span className="mono-text text-[10px] text-on-surface-variant truncate max-w-[60%]" title={currentScopePath}>
                  {currentScopePath}
                </span>
              )}
            </div>
            <TaxonomicScopeSelector value={taxonomicScope} onChange={(scope) => setTaxonomicScope(scope)} compact />
          </div>

          <div className="space-y-xs">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Region</label>
            <RegionInput value={region} onChange={setRegion} compact />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm border border-surface-dim hover:bg-surface-container-low"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || updateChecklist.isPending}
            className="bg-brand text-white mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
