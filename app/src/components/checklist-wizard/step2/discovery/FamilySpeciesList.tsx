"use client";

import { useMemo, useState } from "react";
import type { ParsedSpeciesRow } from "@/modules/checklist/utils/speciesFileParser";

export interface DiscoverySpeciesItem {
  scientificName: string;
  commonName?: string;
  family?: string;
  occurrenceCount?: number;
  eventDate?: string;
}

export interface FamilySpeciesListProps {
  items: DiscoverySpeciesItem[];
  /** Global cross-tab selection, keyed by lowercase scientific name. */
  selected: Map<string, ParsedSpeciesRow>;
  onToggle: (item: DiscoverySpeciesItem) => void;
}

const UNKNOWN_FAMILY = "Unknown";

function speciesKey(scientificName: string): string {
  return scientificName.trim().toLowerCase();
}

function toRow(item: DiscoverySpeciesItem): ParsedSpeciesRow {
  return {
    scientific_name: item.scientificName,
    common_name: item.commonName,
    occurrence_count: item.occurrenceCount,
    event_date: item.eventDate,
  };
}

/** Collapsible family-grouped, checkbox-selectable species list shared across discovery tabs. */
export function FamilySpeciesList({ items, selected, onToggle }: FamilySpeciesListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const families = useMemo(() => {
    const groups = new Map<string, DiscoverySpeciesItem[]>();
    for (const item of items) {
      const family = item.family || UNKNOWN_FAMILY;
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family)!.push(item);
    }
    return Array.from(groups.entries())
      .map(([family, speciesList]) => ({
        family,
        species: speciesList.sort((a, b) => a.scientificName.localeCompare(b.scientificName)),
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }, [items]);

  if (items.length === 0) {
    return <p className="text-sm text-on-surface-variant px-1">No species found.</p>;
  }

  function toggleExpanded(family: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  return (
    <div className="border border-outline-variant bg-white p-3 flex flex-col gap-1">
      {families.map(({ family, species }) => {
        const isOpen = expanded.has(family);
        const allSelected = species.every((s) => selected.has(speciesKey(s.scientificName)));

        return (
          <div key={family}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleExpanded(family)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpanded(family);
                }
              }}
              className="w-full flex items-center gap-2 py-1 text-left transition-colors group rounded-sm hover:bg-surface-container-low cursor-pointer"
            >
              <span
                className={`material-symbols-outlined text-[16px] text-on-surface-variant transition-transform ${
                  isOpen ? "rotate-90" : ""
                }`}
              >
                chevron_right
              </span>
              <input
                type="checkbox"
                checked={allSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => species.forEach((s) => onToggle(s))}
                className="shrink-0"
                aria-label={`Select all in ${family}`}
              />
              <span className="font-bold text-primary text-sm">{family}</span>
              <span className="text-sm italic text-surface-dim">
                {species.length} species
              </span>
            </div>

            {isOpen && (
              <div className="ml-3 border-l border-outline-variant/40 pl-3 mt-1 mb-1 flex flex-col gap-1">
                {species.map((item) => {
                  const key = speciesKey(item.scientificName);
                  const isSelected = selected.has(key);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 py-1 text-sm hover:bg-surface-container-low transition-colors cursor-pointer rounded-sm px-1"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(item)}
                        className="shrink-0"
                      />
                      <span className="italic">{item.scientificName}</span>
                      {item.commonName && (
                        <span className="text-on-surface-variant">{item.commonName}</span>
                      )}
                      {item.occurrenceCount !== undefined && (
                        <span className="ml-auto mono-text text-[12px] text-on-surface-variant">
                          {item.occurrenceCount} records
                        </span>
                      )}
                      {item.eventDate && (
                        <span className="mono-text text-[12px] text-on-surface-variant/70">
                          · Latest: {item.eventDate}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { toRow as discoveryItemToRow, speciesKey as discoverySpeciesKey };
