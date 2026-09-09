"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getChildTaxa, matchTaxonAtRank, type GbifTaxon } from "@/modules/taxonomy/services/taxonomyApi";
import { getInatChildTaxa, resolveInatTaxon, type InatTaxon } from "@/modules/taxonomy/services/inatTaxonomyApi";
import {
  CORE_RANKS,
  type RankName,
  compareRanks,
  isGbifRank,
  optionalRanksUnder,
  rankIndex,
  toGbifRank,
} from "@/lib/taxonomy/ranks";
import { buildScope, enabledRanksOf, scopeNodes, scopeSignature } from "@/lib/taxonomy/scopeNodes";
import type { ScopeNode, TaxonomicScope } from "@/types/checklist.types";

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

/** A pickable taxon, from whichever backbone supplied this level. */
interface TaxonOption {
  name: string;
  gbifKey: number | null;
  inatId: number | null;
}

function fromGbif(t: GbifTaxon): TaxonOption {
  return { name: t.canonicalName ?? t.scientificName, gbifKey: t.key, inatId: null };
}

function fromInat(t: InatTaxon): TaxonOption {
  return { name: t.name, gbifKey: null, inatId: t.id };
}

export interface TaxonomicScopeSelectorProps {
  value: TaxonomicScope;
  /**
   * Reports the full scope plus the GBIF key of the deepest included rank.
   * The key is kept in the signature for callers that still pass it around
   * separately; it is also stored on the scope's nodes.
   */
  onChange: (scope: TaxonomicScope, deepestTaxonKey: number | null) => void;
  /** Smaller text/padding for use in compact contexts (e.g. the Settings dialog) instead of the full-page wizard. */
  compact?: boolean;
}

function includeAt(nodes: ScopeNode[], rank: RankName): ScopeNode | undefined {
  return nodes.find((n) => n.rank === rank && n.mode === "include");
}

function excludesAt(nodes: ScopeNode[], rank: RankName): ScopeNode[] {
  return nodes.filter((n) => n.rank === rank && n.mode === "exclude");
}

/**
 * Kingdom → Species chain selector with optional intermediate ranks.
 *
 * The seven principal ranks always get a row. Each one carries toggle chips
 * for the sub-ranks that sit beneath it (Order → Suborder / Infraorder /
 * Superfamily, and so on); enabling a chip inserts that rank's row at its
 * proper depth. The user can stop at any level.
 *
 * Any taxon can be **excluded** as well as included, which is the only way to
 * express a paraphyletic group: moths are order Lepidoptera with superfamily
 * Papilionoidea excluded, and without that they are indistinguishable from
 * butterflies.
 *
 * Levels are sourced from whichever backbone can answer them — GBIF for the
 * principal ranks, iNaturalist for the sub-ranks GBIF's backbone has no taxa
 * at, and iNaturalist for principal ranks once the chain has passed through
 * one of those (GBIF no longer knows the parent). Keys from the other
 * backbone are bridged lazily on selection, never for a whole option list.
 */
export function TaxonomicScopeSelector({ value, onChange, compact = false }: TaxonomicScopeSelectorProps) {
  const nodes = useMemo(() => scopeNodes(value), [value]);
  const enabledRanks = useMemo(() => enabledRanksOf(value), [value]);

  const visibleRanks = useMemo(() => {
    const ranks = new Set<RankName>([...CORE_RANKS, ...enabledRanks]);
    return [...ranks].sort(compareRanks);
  }, [enabledRanks]);

  const firstUnset = visibleRanks.find((r) => !includeAt(nodes, r));
  const [openRank, setOpenRank] = useState<RankName | null>(firstUnset ?? "kingdom");
  const [search, setSearch] = useState("");

  // Distinguishing a scope this component produced from one handed to it —
  // the wizard applying a title suggestion replaces the whole value from
  // outside. Both are tracked as state rather than refs so the comparison can
  // happen during render.
  const signature = scopeSignature(value);
  const [seenSignature, setSeenSignature] = useState(signature);
  const [lastEmitted, setLastEmitted] = useState<string | null>(null);

  if (signature !== seenSignature) {
    setSeenSignature(signature);
    // A suggestion replaced the whole scope. Whatever row happened to be open
    // is now stale — and leaving it open pops a dropdown for a rank the user
    // never touched, right after they clicked a button somewhere else.
    if (signature !== lastEmitted) {
      setOpenRank(null);
      setSearch("");
    }
  }

  function emit(nextNodes: ScopeNode[], nextEnabled: RankName[]) {
    const scope = buildScope(nextNodes, nextEnabled);
    setLastEmitted(scopeSignature(scope));
    const deepest = [...(scope.nodes ?? [])]
      .filter((n) => n.mode === "include" && n.gbifKey)
      .pop();
    onChange(scope, deepest?.gbifKey ?? null);
  }

  /** Selecting at a rank replaces its include and drops everything deeper. */
  function selectTaxon(rank: RankName, option: TaxonOption) {
    const kept = nodes.filter((n) => rankIndex(n.rank) < rankIndex(rank));
    const next: ScopeNode[] = [
      ...kept,
      { rank, name: option.name, gbifKey: option.gbifKey, inatId: option.inatId, mode: "include" },
    ];
    setSearch("");
    const following = visibleRanks[visibleRanks.indexOf(rank) + 1];
    setOpenRank(following ?? null);
    emit(next, enabledRanks);

    // An option that came from iNat has no GBIF key. The import path needs
    // one for every principal rank, so bridge it in the background and emit
    // again — the selection is usable immediately either way.
    if (!option.gbifKey && isGbifRank(rank)) {
      void matchTaxonAtRank(option.name, toGbifRank(rank))
        .then((match) => {
          if (!match) return;
          emit(
            next.map((n) =>
              n.rank === rank && n.name === option.name
                ? { ...n, gbifKey: match.acceptedUsageKey ?? match.usageKey }
                : n,
            ),
            enabledRanks,
          );
        })
        .catch(() => undefined);
    }
  }

  /** Excluding is additive and independent of the include at the same rank. */
  function toggleExclude(rank: RankName, option: TaxonOption) {
    const already = excludesAt(nodes, rank).some((n) => n.name === option.name);
    const next = already
      ? nodes.filter((n) => !(n.rank === rank && n.mode === "exclude" && n.name === option.name))
      : [
          ...nodes,
          { rank, name: option.name, gbifKey: option.gbifKey, inatId: option.inatId, mode: "exclude" as const },
        ];
    emit(next, enabledRanks);
  }

  function clearNode(target: ScopeNode) {
    const next =
      target.mode === "include"
        ? nodes.filter((n) => rankIndex(n.rank) < rankIndex(target.rank))
        : nodes.filter((n) => n !== target);
    setOpenRank(target.rank);
    emit(next, enabledRanks);
  }

  function toggleOptionalRank(rank: RankName) {
    if (enabledRanks.includes(rank)) {
      emit(
        nodes.filter((n) => n.rank !== rank),
        enabledRanks.filter((r) => r !== rank),
      );
    } else {
      emit(nodes, [...enabledRanks, rank]);
      setOpenRank(rank);
    }
  }

  return (
    <div className={`border border-outline-variant bg-white ${compact ? "p-2" : "p-3"}`}>
      {visibleRanks.map((rank, i) => {
        const previous = i === 0 ? null : visibleRanks[i - 1];
        const parent = previous ? includeAt(nodes, previous) : null;
        const isLocked = i > 0 && !parent;
        const selected = includeAt(nodes, rank);
        const excluded = excludesAt(nodes, rank);

        // Render down to the first unfilled rank and stop. Deeper rows would
        // only read "select the level above first", which is noise.
        const firstUnfilled = visibleRanks.findIndex((r) => !includeAt(nodes, r));
        if (firstUnfilled !== -1 && i > firstUnfilled) return null;

        return (
          <TaxonLevelRow
            key={rank}
            rank={rank}
            depth={i}
            parent={parent ?? null}
            ancestorNames={nodes
              .filter((n) => n.mode === "include" && rankIndex(n.rank) < rankIndex(rank))
              .map((n) => n.name)}
            selected={selected}
            excluded={excluded}
            isLocked={isLocked}
            previousRank={previous}
            isOpen={openRank === rank}
            enabledRanks={enabledRanks}
            search={search}
            onSearchChange={setSearch}
            onToggleOpen={() => setOpenRank((cur) => (cur === rank ? null : rank))}
            onSelect={(option) => selectTaxon(rank, option)}
            onToggleExclude={(option) => toggleExclude(rank, option)}
            onClear={clearNode}
            onToggleOptionalRank={toggleOptionalRank}
            compact={compact}
          />
        );
      })}

      <ScopeSummaryNote nodes={nodes} compact={compact} />
    </div>
  );
}

/**
 * Plain-language read-out of what the current scope actually covers.
 *
 * The rank tree shows which taxa are picked but not what that *means* for the
 * import, and the two come apart as soon as an exclusion is involved — a row
 * reading "Lepidoptera" with a struck-through "Papilionoidea" underneath is a
 * moth checklist, which is not obvious from the rows alone. This also carries
 * the only mention of the exclude control, which is otherwise hidden until
 * hover.
 */
function ScopeSummaryNote({ nodes, compact }: { nodes: ScopeNode[]; compact: boolean }) {
  const included = nodes.filter((n) => n.mode === "include");
  const excluded = nodes.filter((n) => n.mode === "exclude");
  const deepest = included[included.length - 1];

  return (
    <div
      className={`mt-2 pt-2 border-t border-outline-variant/40 flex gap-1.5 ${
        compact ? "text-[11px]" : "text-xs"
      } text-on-surface-variant/80 leading-relaxed`}
    >
      <span className="material-symbols-outlined text-[15px] shrink-0 mt-px opacity-70">info</span>
      <div className="space-y-1">
        {deepest ? (
          <p>
            <span className="font-semibold text-on-surface-variant">Included:</span> every species under{" "}
            {deepest.rank} <span className="italic">{deepest.name}</span>.
          </p>
        ) : (
          <p>Pick a rank below to set your scope — everything underneath it will be included.</p>
        )}

        {excluded.length > 0 && (
          <p>
            <span className="font-semibold text-on-surface-variant">Excluded:</span>{" "}
            {excluded.map((n) => n.name).join(", ")} — and everything beneath{" "}
            {excluded.length > 1 ? "those" : "that"}.
          </p>
        )}

        {excluded.length === 0 && (
          <p className="opacity-80">
            Each option has two buttons:{" "}
            <span className="material-symbols-outlined text-[15px] align-text-bottom font-bold text-primary">
              add
            </span>{" "}
            <span className="font-semibold">includes</span> it and everything under it,{" "}
            <span className="material-symbols-outlined text-[15px] align-text-bottom font-bold text-on-surface-variant">
              remove
            </span>{" "}
            <span className="font-semibold">excludes</span> it. Example: include order <em>Lepidoptera</em> and
            exclude <em>Papilionoidea</em> to get every moth but no butterflies.
          </p>
        )}
      </div>
    </div>
  );
}

function TaxonLevelRow({
  rank,
  depth,
  parent,
  ancestorNames,
  selected,
  excluded,
  isLocked,
  previousRank,
  isOpen,
  enabledRanks,
  search,
  onSearchChange,
  onToggleOpen,
  onSelect,
  onToggleExclude,
  onClear,
  onToggleOptionalRank,
  compact,
}: {
  rank: RankName;
  depth: number;
  parent: ScopeNode | null;
  ancestorNames: string[];
  selected: ScopeNode | undefined;
  excluded: ScopeNode[];
  isLocked: boolean;
  previousRank: RankName | null;
  isOpen: boolean;
  enabledRanks: RankName[];
  search: string;
  onSearchChange: (v: string) => void;
  onToggleOpen: () => void;
  onSelect: (option: TaxonOption) => void;
  onToggleExclude: (option: TaxonOption) => void;
  onClear: (node: ScopeNode) => void;
  onToggleOptionalRank: (rank: RankName) => void;
  compact: boolean;
}) {
  const textSize = compact ? "text-xs" : "text-sm";
  const chips = optionalRanksUnder(rank);
  // Indent is per-depth and unbounded (18 ranks), so it goes through an
  // inline style rather than a Tailwind class — Tailwind v4 can only emit
  // classes it can see as literal strings at build time.
  const indentStyle = depth > 0 ? { marginLeft: `${depth * (compact ? 8 : 12)}px` } : undefined;

  return (
    <div
      style={indentStyle}
      className={depth > 0 ? `${compact ? "pl-2" : "pl-3"} border-l border-outline-variant/40 mt-1` : undefined}
    >
      <div
        role="button"
        tabIndex={isLocked ? -1 : 0}
        onClick={() => !isLocked && onToggleOpen()}
        onKeyDown={(e) => {
          if (!isLocked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggleOpen();
          }
        }}
        className={`w-full flex items-center gap-2 py-1 text-left transition-colors group rounded-sm ${
          isLocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-container-low cursor-pointer"
        }`}
        aria-disabled={isLocked}
      >
        <span
          className={`material-symbols-outlined ${compact ? "text-[14px]" : "text-[16px]"} text-on-surface-variant transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          {selected ? "folder_open" : "chevron_right"}
        </span>
        <span className={`font-bold text-primary ${textSize} capitalize ${compact ? "w-16" : "w-20"} shrink-0`}>
          {rank}:
        </span>

        {selected ? (
          <SelectedPill node={selected} onClear={onClear} textSize={textSize} />
        ) : (
          <span className={`${textSize} italic text-surface-dim`}>
            {isLocked ? `Select ${previousRank} first…` : `Select ${rank}…`}
          </span>
        )}

        {excluded.map((node) => (
          <SelectedPill key={`x-${node.name}`} node={node} onClear={onClear} textSize={textSize} />
        ))}

        {chips.length > 0 && (
          <span className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {chips.map((optional) => {
              const on = enabledRanks.includes(optional);
              return (
                <button
                  key={optional}
                  type="button"
                  onClick={() => onToggleOptionalRank(optional)}
                  aria-pressed={on}
                  title={on ? `Remove the ${optional} level` : `Add a ${optional} level`}
                  className={`px-2 py-1 rounded-sm border text-xs capitalize transition-colors ${
                    on
                      ? "border-primary bg-primary-container/40 text-primary font-bold"
                      : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                  }`}
                >
                  {on ? "−" : "+"} {optional}
                </button>
              );
            })}
          </span>
        )}
      </div>

      {isOpen && !isLocked && (
        <TaxonLevelOptions
          rank={rank}
          parent={parent}
          ancestorNames={ancestorNames}
          selectedName={selected?.name ?? null}
          excludedNames={excluded.map((n) => n.name)}
          search={search}
          onSearchChange={onSearchChange}
          onSelect={onSelect}
          onToggleExclude={onToggleExclude}
          compact={compact}
        />
      )}
    </div>
  );
}

function SelectedPill({
  node,
  onClear,
  textSize,
}: {
  node: ScopeNode;
  onClear: (node: ScopeNode) => void;
  textSize: string;
}) {
  const isExclude = node.mode === "exclude";
  return (
    <span
      className={`${textSize} font-medium not-italic group/pill px-1.5 py-0.5 rounded-sm inline-flex items-center gap-1 ${
        isExclude
          ? "bg-surface-container-low text-on-surface-variant line-through decoration-1 decoration-on-surface-variant/40"
          : "text-on-surface bg-primary-container/30"
      }`}
      title={isExclude ? `${node.name} is excluded from this scope` : undefined}
    >
      {/* A plain minus rather than a filled "block" glyph: at pill size the
          icon read as an error state, which excluding a group is not. */}
      {isExclude && <span className="no-underline text-on-surface-variant/70">−</span>}
      {node.name}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClear(node);
        }}
        // Collapsed to 0 width until hover/focus, rather than just opacity-0 —
        // an invisible-but-still-laid-out button left a strip of dead space on
        // every pill's right edge that read as an oversized/empty border.
        className="grid place-items-center w-0 group-hover/pill:w-3 focus-visible:w-3 overflow-hidden text-on-surface-variant/50 hover:text-on-surface transition-all focus-visible:outline-none"
        aria-label={`Clear ${node.name}`}
      >
        <span className="material-symbols-outlined text-[12px] leading-none no-underline">close</span>
      </button>
    </span>
  );
}

function TaxonLevelOptions({
  rank,
  parent,
  ancestorNames,
  selectedName,
  excludedNames,
  search,
  onSearchChange,
  onSelect,
  onToggleExclude,
  compact,
}: {
  rank: RankName;
  parent: ScopeNode | null;
  ancestorNames: string[];
  selectedName: string | null;
  excludedNames: string[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (option: TaxonOption) => void;
  onToggleExclude: (option: TaxonOption) => void;
  compact: boolean;
}) {
  // GBIF can answer a principal rank only while the chain above it is still
  // GBIF-resolved. Once the scope passes through a rank GBIF has no taxa at,
  // the parent has no GBIF key and the rest of the chain comes from iNat.
  const useGbif = rank === "kingdom" || (isGbifRank(rank) && Boolean(parent?.gbifKey));

  const { data, isLoading, error } = useQuery({
    queryKey: ["scope-options", rank, useGbif ? `g:${parent?.gbifKey ?? 0}` : `i:${parent?.inatId ?? parent?.name ?? ""}`],
    queryFn: async (): Promise<TaxonOption[]> => {
      if (rank === "kingdom") return KINGDOMS.map(fromGbif);
      if (useGbif) return (await getChildTaxa(parent!.gbifKey!)).map(fromGbif);

      // Bridge the parent into iNat if it was picked from GBIF and has no
      // iNat id yet. Ancestor names disambiguate homonyms across kingdoms.
      let ancestorId = parent?.inatId ?? null;
      if (!ancestorId && parent) {
        const bridged = await resolveInatTaxon(parent.name, parent.rank, ancestorNames);
        ancestorId = bridged?.id ?? null;
      }
      if (!ancestorId) return [];
      return (await getInatChildTaxa(ancestorId, rank)).map(fromInat);
    },
    enabled: rank === "kingdom" || Boolean(parent),
    staleTime: 30 * 60 * 1000,
  });

  const options = (data ?? []).filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const textSize = compact ? "text-xs" : "text-sm";

  return (
    <div className={`${compact ? "ml-2 pl-2" : "ml-3 pl-3"} border-l border-outline-variant/40 mt-1 mb-1 flex flex-col gap-2`}>
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
        />
      </div>

      {isLoading && <p className={`${textSize} text-on-surface-variant px-1`}>Loading…</p>}
      {error && <p className={`${textSize} text-red-600 px-1`}>Failed to load {rank} options.</p>}
      {!isLoading && !error && !options.length && (
        <p className={`${textSize} text-on-surface-variant/60 italic px-2 py-1.5`}>
          {data?.length ? "No matches." : `No ${rank} level recorded below ${parent?.name ?? "this taxon"}.`}
        </p>
      )}

      <div className={`${compact ? "max-h-36" : "max-h-48"} overflow-y-auto flex flex-col`}>
        {options.map((taxon) => {
          const isSelected = taxon.name === selectedName;
          const isExcluded = excludedNames.includes(taxon.name);
          return (
            <div
              key={`${taxon.gbifKey ?? "i"}-${taxon.inatId ?? "g"}-${taxon.name}`}
              className="flex items-center group hover:bg-surface-container-low transition-colors"
            >
              {/* + always visible: include this taxon (and drill into it). Filled/primary once selected. */}
              <button
                type="button"
                onClick={() => onSelect(taxon)}
                aria-pressed={isSelected}
                title={`Include ${taxon.name} — everything under it`}
                className={`shrink-0 pl-2 material-symbols-outlined ${compact ? "text-[15px]" : "text-[17px]"} transition-colors ${
                  isSelected ? "text-primary" : "text-on-surface-variant/40 hover:text-primary"
                }`}
              >
                {isSelected ? "add_circle" : "add"}
              </button>
              <button
                type="button"
                onClick={() => onSelect(taxon)}
                className={`flex-1 text-left px-2 ${compact ? "py-1" : "py-1.5"} ${textSize} italic ${
                  isSelected ? "text-primary font-bold" : ""
                } ${isExcluded ? "line-through decoration-1 decoration-on-surface-variant/40 text-on-surface-variant/60" : ""}`}
              >
                {taxon.name}
              </button>
              {/* − always visible: exclude this taxon (and everything under it) from an otherwise-included ancestor. */}
              <button
                type="button"
                onClick={() => onToggleExclude(taxon)}
                aria-pressed={isExcluded}
                title={isExcluded ? `Stop excluding ${taxon.name}` : `Exclude ${taxon.name} from this scope`}
                className={`shrink-0 pr-2 material-symbols-outlined ${compact ? "text-[15px]" : "text-[17px]"} transition-colors ${
                  isExcluded ? "text-on-surface-variant" : "text-on-surface-variant/30 hover:text-on-surface-variant"
                }`}
              >
                {isExcluded ? "do_not_disturb_on" : "remove"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
