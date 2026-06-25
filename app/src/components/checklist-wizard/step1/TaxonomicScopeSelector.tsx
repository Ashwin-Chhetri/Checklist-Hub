"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getChildTaxa, type GbifTaxon } from "@/modules/taxonomy/services/taxonomyApi";
import type { TaxonomicScope } from "@/types/checklist.types";

const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;
type Rank = (typeof RANKS)[number];

// GBIF backbone kingdom usage keys — the only fixed/static level in the chain.
const KINGDOMS: GbifTaxon[] = [
  { key: 1, scientificName: "Animalia", canonicalName: "Animalia", rank: "KINGDOM" },
  { key: 6, scientificName: "Plantae", canonicalName: "Plantae", rank: "KINGDOM" },
  { key: 5, scientificName: "Fungi", canonicalName: "Fungi", rank: "KINGDOM" },
  { key: 4, scientificName: "Chromista", canonicalName: "Chromista", rank: "KINGDOM" },
  { key: 7, scientificName: "Protozoa", canonicalName: "Protozoa", rank: "KINGDOM" },
  { key: 3, scientificName: "Bacteria", canonicalName: "Bacteria", rank: "KINGDOM" },
  { key: 2, scientificName: "Archaea", canonicalName: "Archaea", rank: "KINGDOM" },
  { key: 8, scientificName: "Viruses", canonicalName: "Viruses", rank: "KINGDOM" },
];

interface SelectedTaxon {
  key: number;
  name: string;
}

export interface TaxonomicScopeSelectorProps {
  value: TaxonomicScope;
  /** Also reports the resolved GBIF taxon key for the deepest selected rank, used for evidence/region verification. */
  onChange: (scope: TaxonomicScope, deepestTaxonKey: number | null) => void;
  /** Smaller text/padding for use in compact contexts (e.g. the Settings dialog) instead of the full-page wizard. */
  compact?: boolean;
}

function matchKingdom(name: string): GbifTaxon | undefined {
  return KINGDOMS.find((k) => (k.canonicalName ?? k.scientificName).toLowerCase() === name.toLowerCase());
}

/**
 * Kingdom > Phylum > Class > Order > Family > Genus > Species chain selector,
 * styled as a collapsible hierarchy tree (per UI/code/checklist_creation/step_1_details.html).
 * The user can stop at any level — the deepest selected rank defines the scope.
 * Each level loads its options as children of the previous level's selection
 * from the GBIF backbone, so the chain always reflects a valid taxonomic path.
 */
export function TaxonomicScopeSelector({ value, onChange, compact = false }: TaxonomicScopeSelectorProps) {
  // selections[i] = the chosen taxon for RANKS[i], or null if not yet chosen.
  // `value` only carries names (no GBIF keys), e.g. when restored from a saved
  // draft or after this component remounts on navigating back to this step —
  // the kingdom's key is resolved immediately from the static list; deeper
  // ranks start as an unresolved placeholder (key: -1) and are backfilled by
  // the effect below, since a real key is required to query their own
  // children (and to know they aren't locked — see TaxonLevel's isLocked).
  const [selections, setSelections] = useState<(SelectedTaxon | null)[]>(() =>
    RANKS.map((rank, i) => {
      if (!value[rank]) return null;
      if (i === 0) {
        const match = matchKingdom(value[rank]!);
        return { key: match ? match.key : -1, name: value[rank]! };
      }
      return { key: -1, name: value[rank]! };
    }),
  );
  // Which rank's option list is currently open for picking (independent of what's selected).
  const [openRank, setOpenRank] = useState<Rank | null>(
    () => RANKS[selections.findIndex((s) => !s) === -1 ? RANKS.length - 1 : selections.findIndex((s) => !s)] ?? "kingdom",
  );
  const [search, setSearch] = useState("");

  // Backfill real GBIF keys for any restored rank beyond kingdom (key === -1)
  // by walking the chain via getChildTaxa, matching each level's saved name
  // against its resolved parent's children. Runs once on mount; intentionally
  // reads the initial `selections` via a ref rather than the reactive state so
  // it doesn't re-run as it patches each level in.
  const initialSelections = useRef(selections);
  useEffect(() => {
    let cancelled = false;
    async function resolveChain() {
      let parentKey = initialSelections.current[0]?.key ?? null;
      if (parentKey === null || parentKey < 0) return;
      for (let i = 1; i < RANKS.length; i++) {
        const sel = initialSelections.current[i];
        if (!sel) return;
        if (sel.key > 0) {
          parentKey = sel.key;
          continue;
        }
        try {
          const children = await getChildTaxa(parentKey);
          if (cancelled) return;
          const match = children.find((c) => (c.canonicalName ?? c.scientificName).toLowerCase() === sel.name.toLowerCase());
          if (!match) return;
          parentKey = match.key;
          setSelections((prev) => {
            const next = [...prev];
            next[i] = { key: match.key, name: sel.name };
            return next;
          });
        } catch {
          return;
        }
      }
    }
    void resolveChain();
    return () => {
      cancelled = true;
    };
  }, []);

  function applySelections(next: (SelectedTaxon | null)[]) {
    setSelections(next);
    const scope: TaxonomicScope = {};
    next.forEach((sel, i) => {
      if (sel) scope[RANKS[i]] = sel.name;
    });
    const deepest = [...next].reverse().find((s) => s && s.key > 0);
    onChange(scope, deepest ? deepest.key : null);
  }

  function selectTaxon(levelIdx: number, taxon: GbifTaxon) {
    const next = selections.slice(0, levelIdx);
    next[levelIdx] = { key: taxon.key, name: taxon.canonicalName ?? taxon.scientificName };
    while (next.length < RANKS.length) next.push(null);
    setSearch("");

    const nextRank = RANKS[levelIdx + 1];
    setOpenRank(nextRank ?? null);
    applySelections(next);
  }

  function clearFrom(levelIdx: number) {
    const next = selections.slice(0, levelIdx);
    while (next.length < RANKS.length) next.push(null);
    setOpenRank(RANKS[levelIdx]);
    applySelections(next);
  }

  return (
    <div className={`border border-outline-variant bg-white ${compact ? "p-2" : "p-3"}`}>
      <TaxonLevel
        rankIdx={0}
        selections={selections}
        openRank={openRank}
        search={search}
        onSearchChange={setSearch}
        onToggle={(rank) => setOpenRank((cur) => (cur === rank ? null : rank))}
        onSelect={selectTaxon}
        onClear={clearFrom}
        compact={compact}
      />
    </div>
  );
}

function TaxonLevel({
  rankIdx,
  selections,
  openRank,
  search,
  onSearchChange,
  onToggle,
  onSelect,
  onClear,
  compact = false,
}: {
  rankIdx: number;
  selections: (SelectedTaxon | null)[];
  openRank: Rank | null;
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (rank: Rank) => void;
  onSelect: (levelIdx: number, taxon: GbifTaxon) => void;
  onClear: (levelIdx: number) => void;
  compact?: boolean;
}) {
  if (rankIdx >= RANKS.length) return null;

  const rank = RANKS[rankIdx];
  const selected = selections[rankIdx];
  const parent = rankIdx === 0 ? null : selections[rankIdx - 1];
  const isLocked = rankIdx > 0 && (!parent || parent.key < 0);
  const isOpen = openRank === rank;
  const textSize = compact ? "text-xs" : "text-sm";
  const indent = compact ? "ml-2 pl-2" : "ml-3 pl-3";

  return (
    <div className={rankIdx > 0 ? `${indent} border-l border-outline-variant/40 mt-1` : undefined}>
      <div
        role="button"
        tabIndex={isLocked ? -1 : 0}
        onClick={() => !isLocked && onToggle(rank)}
        onKeyDown={(e) => {
          if (!isLocked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle(rank);
          }
        }}
        className={`w-full flex items-center gap-2 py-1 text-left transition-colors group rounded-sm ${isLocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-container-low cursor-pointer"
          }`}
        aria-disabled={isLocked}
      >
        <span
          className={`material-symbols-outlined ${compact ? "text-[14px]" : "text-[16px]"} text-on-surface-variant transition-transform ${isOpen ? "rotate-90" : ""
            }`}
        >
          {selected ? "folder_open" : "chevron_right"}
        </span>
        <span className={`font-bold text-primary ${textSize} capitalize ${compact ? "w-12" : "w-16"} shrink-0`}>{rank}:</span>
        {selected ? (
          <span className={`${textSize} text-on-surface bg-primary-container/30 px-2 py-0.5 rounded-sm`}>
            {selected.name}
          </span>
        ) : (
          <span className={`${textSize} italic text-surface-dim`}>
            {isLocked ? `Select ${RANKS[rankIdx - 1]} first…` : `Select ${rank}…`}
          </span>
        )}
        {selected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear(rankIdx);
            }}
            className="ml-auto text-on-surface-variant hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
            aria-label={`Clear ${rank}`}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {isOpen && !isLocked && (
        <TaxonLevelOptions
          rank={rank}
          parentKey={parent?.key ?? null}
          search={search}
          onSearchChange={onSearchChange}
          onSelect={(taxon) => onSelect(rankIdx, taxon)}
          compact={compact}
        />
      )}

      {selected && (
        <TaxonLevel
          rankIdx={rankIdx + 1}
          selections={selections}
          openRank={openRank}
          search={search}
          onSearchChange={onSearchChange}
          onToggle={onToggle}
          onSelect={onSelect}
          onClear={onClear}
          compact={compact}
        />
      )}

      {selected && rankIdx === RANKS.length - 1 && (
        <div className={`${indent} border-l border-outline-variant/40 mt-1 flex items-center gap-2 py-1 text-surface-dim`}>
          <span className="material-symbols-outlined text-[16px]">subdirectory_arrow_right</span>
          <span className={`italic ${textSize}`}>Scope set to species level.</span>
        </div>
      )}
    </div>
  );
}

function TaxonLevelOptions({
  rank,
  parentKey,
  search,
  onSearchChange,
  onSelect,
  compact = false,
}: {
  rank: Rank;
  parentKey: number | null;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (taxon: GbifTaxon) => void;
  compact?: boolean;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["gbif-children", rank, parentKey],
    queryFn: () => (rank === "kingdom" ? KINGDOMS : getChildTaxa(parentKey as number)),
    enabled: rank === "kingdom" || parentKey !== null,
  });

  const options = (data ?? []).filter((t) =>
    (t.canonicalName ?? t.scientificName).toLowerCase().includes(search.toLowerCase()),
  );
  const textSize = compact ? "text-xs" : "text-sm";
  const indent = compact ? "ml-2 pl-2" : "ml-3 pl-3";

  return (
    <div className={`${indent} border-l border-outline-variant/40 mt-1 mb-1 flex flex-col gap-2`}>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]">
          search
        </span>
        <input
          className={`w-full bg-surface-container-low border border-outline-variant pl-8 pr-3 ${compact ? "py-1" : "py-1.5"} ${textSize} focus:border-primary focus:outline-none`}
          placeholder={`Search ${rank}…`}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />
      </div>

      {isLoading && <p className={`${textSize} text-on-surface-variant px-1`}>Loading…</p>}
      {error && <p className={`${textSize} text-red-600 px-1`}>Failed to load {rank} options.</p>}

      <div className={`${compact ? "max-h-36" : "max-h-48"} overflow-y-auto flex flex-col`}>
        {options.map((taxon) => (
          <button
            key={taxon.key}
            type="button"
            onClick={() => onSelect(taxon)}
            className={`text-left px-2 ${compact ? "py-1" : "py-1.5"} ${textSize} hover:bg-surface-container-low transition-colors flex items-center gap-2 italic`}
          >
            {taxon.canonicalName ?? taxon.scientificName}
          </button>
        ))}
        {!isLoading && options.length === 0 && (
          <p className={`${textSize} text-on-surface-variant/60 italic px-2 py-1.5`}>No matches.</p>
        )}
      </div>
    </div>
  );
}
