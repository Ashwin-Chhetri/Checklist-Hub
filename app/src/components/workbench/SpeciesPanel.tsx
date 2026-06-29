"use client";

import { useState } from "react";
import type { Species } from "@/types/species.types";
import type { Collaborator } from "@/types/collaboration.types";
import DiscussionPanel from "./panels/DiscussionPanel";
import EvidencePanel from "./panels/EvidencePanel";
import TaxonomyPanel from "./panels/TaxonomyPanel";
import { sortConflictsGbifFirst } from "@/modules/taxonomy/utils/sortConflicts";

type PanelTab = "discussion" | "evidence" | "taxonomy";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "taxonomy", label: "Taxonomy" },
  { id: "evidence", label: "Evidence" },
  { id: "discussion", label: "Discussion" },
];

interface PanelTabRequest {
  speciesId: string;
  tab: PanelTab;
}

export interface ChecklistRegion {
  gadmId: string | null;
  name: string | null;
  country: string | null;
  state: string | null;
  district: string | null;
  /** OSM element identity for the region — used by the Evidence map to fetch
   * a boundary straight from Nominatim when GADM has no geometry for this
   * region's gadmId (e.g. a state/country-level GADM match). */
  osmType: string | null;
  osmId: string | null;
}

interface SpeciesPanelProps {
  species: Species | null;
  checklistId: string;
  /** The checklist's region — used by the Evidence tab's region map and its
   * eBird/iNaturalist occurrence lookups. */
  region?: ChecklistRegion;
  collaborators?: Collaborator[];
  speciesList?: Species[];
  /** A one-shot request to force-open a specific tab for a specific species (e.g. clicking a row's comment icon, or a comment-related notification). Applied once, then superseded by normal tab clicks. */
  panelTabRequest?: PanelTabRequest | null;
  onClose: () => void;
  onSelectSpecies?: (speciesId: string) => void;
}

export default function SpeciesPanel({
  species,
  checklistId,
  region,
  collaborators = [],
  speciesList = [],
  panelTabRequest,
  onClose,
  onSelectSpecies,
}: SpeciesPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("taxonomy");

  // Apply a pending tab request once, the same render-time "adjust state on
  // prop change" pattern used below for prevSpeciesId/taxonomyDetailTab —
  // avoids the extra render an effect would cause.
  const [appliedTabRequest, setAppliedTabRequest] = useState<PanelTabRequest | null | undefined>(panelTabRequest);
  if (panelTabRequest !== appliedTabRequest) {
    setAppliedTabRequest(panelTabRequest);
    if (panelTabRequest && panelTabRequest.speciesId === species?.id) {
      setActiveTab(panelTabRequest.tab);
    }
  }

  // Secondary tab bar, shown directly under the main tab bar only for Taxonomy:
  // every scientific name this species could be filed under — its own
  // (imported) name plus every authority-conflict and synonym option — is a
  // first-class taxon. Deduped by name (first occurrence wins).
  const rawTaxonomyOptionNames = [
    ...(species ? [species.scientific_name] : []),
    // GBIF-sourced suggestion first, any other-source suggestion second.
    ...sortConflictsGbifFirst(species?.taxonomy?.authority_conflicts ?? []).map((c) => c.suggested_name),
    ...(species?.taxonomy?.synonyms ?? []).map((s) => s.name),
  ];
  const taxonomyOptionNames = rawTaxonomyOptionNames.filter(
    (name, idx) => rawTaxonomyOptionNames.indexOf(name) === idx,
  );
  const [taxonomyDetailTab, setTaxonomyDetailTab] = useState<string>(taxonomyOptionNames[0] ?? "");

  // Reset to the species' own name whenever the selected species changes, so a
  // stale option name from the previous species' conflicts/synonyms isn't left
  // active. Adjusted during render (not an effect) per React's guidance for
  // resetting state on prop change — avoids the extra render an effect would cause.
  const [prevSpeciesId, setPrevSpeciesId] = useState(species?.id);
  if (species?.id !== prevSpeciesId) {
    setPrevSpeciesId(species?.id);
    setTaxonomyDetailTab(taxonomyOptionNames[0] ?? "");
  }

  return (
    <aside className="bg-white flex flex-col flex-none w-[380px] border-l border-surface-dim overflow-hidden">
      {species ? (
        <>
          {/* Species identity */}
          <div className="px-4 pt-3 pb-2 border-b border-surface-dim bg-surface-container-low/40 flex items-start justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className="mono-text text-sm font-bold italic text-on-surface leading-tight truncate">
                {species.scientific_name}
              </span>
              {species.common_name && (
                <span className="text-[11px] text-on-surface-variant font-medium mt-0.5 truncate">
                  {species.common_name}
                </span>
              )}
            </div>
            <button
              aria-label="Close panel"
              className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 hover:text-brand transition-colors mt-0.5"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div className="flex items-center border-b border-surface-dim bg-white h-9">
            <nav className="flex h-full items-center overflow-hidden flex-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-full px-4 text-[10px] font-bold uppercase tracking-wider mono-text border-l border-surface-dim first:border-l-0 transition-colors ${
                    activeTab === tab.id
                      ? "bg-primary text-white"
                      : "bg-white text-slate-500 hover:bg-surface-container-low"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          {/* Secondary tab bar — only under Taxonomy. Every tab is a scientific
              name: the species' own (imported) name plus each conflict/synonym
              option — no "Overview" tab, since each name is a first-class taxon. */}
          {activeTab === "taxonomy" && taxonomyOptionNames.length > 1 && (
            <div className="flex flex-wrap items-center border-b border-surface-dim bg-surface-container-low/40 overflow-x-auto">
              {taxonomyOptionNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setTaxonomyDetailTab(name)}
                  className={`px-3 py-2 text-[9px] font-bold italic mono-text tracking-wide border-b-2 transition-colors ${
                    taxonomyDetailTab === name
                      ? "border-brand text-brand"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {activeTab === "discussion" && (
            <DiscussionPanel
              species={species}
              checklistId={checklistId}
              collaborators={collaborators}
              speciesList={speciesList}
              onSelectSpecies={onSelectSpecies}
              onSelectTaxonomyRef={(name) => {
                setActiveTab("taxonomy");
                setTaxonomyDetailTab(name);
              }}
              onSelectEvidence={() => setActiveTab("evidence")}
            />
          )}
          {activeTab === "evidence" && (
            <EvidencePanel species={species} checklistId={checklistId} region={region} />
          )}
          {activeTab === "taxonomy" && (
            <TaxonomyPanel species={species} checklistId={checklistId} activeDetailTab={taxonomyDetailTab} />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-on-surface-variant/50 select-none">
          <span className="material-symbols-outlined text-[40px]">info</span>
          <span className="text-xs mono-text uppercase tracking-wider">Select a species to view details</span>
        </div>
      )}
    </aside>
  );
}
