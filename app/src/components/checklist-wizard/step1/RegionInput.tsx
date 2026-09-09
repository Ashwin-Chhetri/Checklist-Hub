"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  resolveGadmId,
  resolvePostalCode,
  searchRegionSuggestions,
  type RegionSuggestion,
} from "@/modules/checklist/services/regionApi";

export interface RegionValue {
  region_name: string;
  region_sub_district?: string;
  region_district: string;
  region_state: string;
  region_country: string;
  region_gadm_id: string;
  region_pin?: string;
  /** OSM element identity for the selected place — lets the Evidence map fall
   * back to Nominatim's own boundary when no district-level GADM geometry
   * exists for this region (e.g. a state/country-level GADM match). */
  region_osm_type?: string;
  region_osm_id?: string;
}

export interface RegionInputProps {
  value: RegionValue;
  onChange: (value: RegionValue) => void;
  /** Smaller text/padding for use in compact contexts (e.g. the Settings dialog) instead of the full-page wizard. */
  compact?: boolean;
}

const EMPTY_VALUE: RegionValue = {
  region_name: "",
  region_sub_district: "",
  region_district: "",
  region_state: "",
  region_country: "",
  region_gadm_id: "",
  region_pin: "",
  region_osm_type: "",
  region_osm_id: "",
};

/** A labelled chip for one region field — omitted entirely when the match has no value for it. */
function RegionField({
  label,
  value,
  valueClassName = "text-on-surface",
}: {
  label: string;
  value?: string | null;
  valueClassName?: string;
}) {
  if (!value) return null;
  return (
    <span>
      <span className="text-on-surface-variant text-xs tracking-wider mr-1">{label}:</span>
      <span className={valueClassName}>{value}</span>
    </span>
  );
}

/** De-duplicate suggestions down to one entry per distinct place.
 *
 * Nominatim frequently returns the *same* place twice under different OSM
 * elements — e.g. an address/POI node and its enclosing administrative
 * boundary way/relation — which otherwise show up as two visually identical
 * rows in the dropdown, one with a postcode and one without. When the
 * address breakdown is populated, key on matched name + district/state/
 * country so those collapse into one row, keeping whichever copy actually
 * carries a pin code.
 *
 * When the breakdown is empty (some countries' Nominatim results don't
 * populate district/state/country consistently), fall back to raw OSM
 * identity instead — a name+address key would incorrectly collapse
 * genuinely different places that all key to the same near-empty tuple
 * (e.g. two different boroughs of the same German city both keying to
 * "||Germany"). */
function dedupeByRegion(suggestions: RegionSuggestion[]): RegionSuggestion[] {
  const byKey = new Map<string, RegionSuggestion>();
  for (const s of suggestions) {
    const hasAddress = Boolean(s.subDistrict || s.district || s.state || s.country);
    const key = hasAddress
      ? `${s.matchedName}|${s.subDistrict}|${s.district}|${s.state}|${s.country}`.toLowerCase()
      : s.osmType && s.osmId
        ? `${s.osmType}:${s.osmId}`
        : `${s.matchedName}|${s.displayName}`.toLowerCase();

    const existing = byKey.get(key);
    if (!existing || (!existing.pin && s.pin)) {
      byKey.set(key, s);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Region picker: typing searches for matching districts, shown as a
 * dropdown of district/state/country/pin chips. Selecting one locks in the
 * region as a chip with a clear ("x") button to start over.
 */
export function RegionInput({ value, onChange, compact = false }: RegionInputProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [resolvingGadm, setResolvingGadm] = useState(false);
  // Set once a GADM resolution attempt has completed without a match — lets
  // the UI distinguish "still resolving" from "gave up with nothing", which
  // otherwise look identical (both just show no gadm chip) and leave the
  // user unable to tell why Continue won't enable.
  const [gadmFailed, setGadmFailed] = useState(false);

  // Read by the async GADM/postal-code resolutions below so each only patches
  // its own field onto whatever the *latest* value is, instead of each
  // reconstructing the whole object from the original suggestion — otherwise
  // whichever of the two resolves last would silently clobber the other's update.
  const latestValueRef = useRef(value);
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 500);
    return () => clearTimeout(handle);
  }, [query]);

  const suggestions = useQuery({
    queryKey: ["region-suggest", debouncedQuery],
    queryFn: () => searchRegionSuggestions(debouncedQuery, 10),
    enabled: debouncedQuery.length >= 3 && open,
  });

  // Accept any level Nominatim actually matched (district, state, or country) —
  // a state/country result has no `district`, so requiring one here would hide it.
  const regionSuggestions = dedupeByRegion(suggestions.data ?? []).filter(
    (s) => s.district || s.state || s.country,
  );

  function selectSuggestion(s: RegionSuggestion) {
    const next: RegionValue = {
      region_name: s.matchedName,
      region_sub_district: s.subDistrict,
      region_district: s.district,
      region_state: s.state,
      region_country: s.country,
      region_gadm_id: "",
      region_pin: s.pin,
      region_osm_type: s.osmType ?? "",
      region_osm_id: s.osmId ?? "",
    };
    onChange(next);
    setOpen(false);
    setQuery("");
    setGadmFailed(false);

    // Resolve a GADM GID for this region so GBIF occurrence queries can be
    // scoped to it. A missing match (no boundary for this place, or the
    // reference-data-service unreachable/misconfigured) is surfaced via
    // `gadmFailed` rather than failing silently — Continue is gated on
    // `region_gadm_id` being set, so the user needs to know why it's stuck.
    setResolvingGadm(true);
    resolveGadmId({ country: s.country, state: s.state, district: s.district })
      .then((gid) => {
        if (!gid) {
          setGadmFailed(true);
          return;
        }
        onChange({ ...latestValueRef.current, region_gadm_id: gid });
      })
      .catch(() => setGadmFailed(true))
      .finally(() => setResolvingGadm(false));

    // Best-effort: district-level forward search rarely carries a postcode —
    // reverse-geocode the suggestion's centroid for a representative pin.
    if (!s.pin && s.lat && s.lon) {
      resolvePostalCode(s.lat, s.lon)
        .then((pin) => {
          if (!pin) return;
          onChange({ ...latestValueRef.current, region_pin: pin });
        })
        .catch(() => {});
    }
  }

  function clearSelection() {
    onChange(EMPTY_VALUE);
    setQuery("");
    setOpen(false);
    setGadmFailed(false);
  }

  const isSelected = Boolean(value.region_district || value.region_state || value.region_country);
  const showDropdown = !isSelected && open && debouncedQuery.length >= 3;
  const pad = compact ? "px-3 py-1.5" : "px-md py-sm";
  const listItemPad = compact ? "px-3 py-1.5" : "px-md py-3";
  const textSize = compact ? "text-xs" : "text-code-md";

  if (isSelected) {
    return (
      <div className={`flex items-center justify-between gap-sm ${pad} border border-outline bg-surface`}>
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 font-code-md ${textSize}`}>
          <RegionField label="match" value={value.region_name} valueClassName="text-on-surface font-bold" />
          <RegionField
            label="district"
            value={value.region_district}
            valueClassName={value.region_name ? "text-on-surface" : "text-on-surface font-bold"}
          />
          <RegionField label="state" value={value.region_state} />
          <RegionField label="country" value={value.region_country} />
          <RegionField label="gadm" value={value.region_gadm_id} valueClassName="text-secondary" />
          {resolvingGadm && !value.region_gadm_id && (
            <span className="text-on-surface-variant text-xs italic">resolving gadm…</span>
          )}
          {!resolvingGadm && !value.region_gadm_id && gadmFailed && (
            <span className="text-red-700 text-xs italic">
              no GADM boundary match found — Continue may stay disabled
            </span>
          )}
          <RegionField label="pin" value={value.region_pin} valueClassName="text-primary font-bold" />
        </div>
        <button
          type="button"
          onClick={clearSelection}
          className="text-on-surface-variant hover:text-primary transition-colors shrink-0"
          aria-label="Clear region selection"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative space-y-xs">
      <div className={`flex items-center gap-sm ${pad} border border-outline bg-surface`}>
        <input
          className={`flex-1 bg-transparent border-none focus:ring-0 p-0 font-code-md ${textSize} outline-none placeholder:text-surface-dim`}
          placeholder="Search for any city, district, state, or country…"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {suggestions.isFetching && (
          <span className="material-symbols-outlined text-on-surface-variant text-[18px] animate-spin shrink-0">
            progress_activity
          </span>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 border border-outline-variant bg-surface shadow-lg max-h-64 overflow-y-auto">
          {suggestions.isError && (
            <p className={`${pad} ${textSize} text-red-600`}>Could not resolve region.</p>
          )}
          {!suggestions.isFetching && regionSuggestions.length === 0 && !suggestions.isError && (
            <p className={`${pad} ${textSize} text-on-surface-variant/70 italic`}>No matching region found.</p>
          )}
          {regionSuggestions.map((s, i) => (
            <button
              key={s.osmType && s.osmId ? `${s.osmType}:${s.osmId}` : `${s.subDistrict}-${s.district}-${s.state}-${s.country}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              className={`w-full text-left ${listItemPad} hover:bg-surface-container-low transition-colors border-b border-outline-variant/40 last:border-b-0 flex flex-wrap items-center gap-x-4 gap-y-1 font-code-md ${textSize}`}
            >
              <RegionField label="match" value={s.matchedName} valueClassName="text-on-surface font-bold" />
              <RegionField label="district" value={s.district} />
              <RegionField label="state" value={s.state} />
              <RegionField label="country" value={s.country} />
              <RegionField label="pin" value={s.pin} valueClassName="text-primary font-bold" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
