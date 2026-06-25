"use client";

import { useMemo, useState } from "react";
import type { Species } from "@/types/species.types";
import { useEvidencePanel } from "@/modules/evidence/hooks/useEvidencePanel";
import { useSpeciesOccurrences } from "@/modules/evidence/hooks/useSpeciesOccurrences";
import { useEbirdOccurrences } from "@/modules/evidence/hooks/useEbirdOccurrences";
import { useInatOccurrences } from "@/modules/evidence/hooks/useInatOccurrences";
import { useRegionBoundary } from "@/modules/checklist/hooks/useRegionBoundary";
import { EVIDENCE_SOURCE_LABELS } from "@/modules/editor/utils/badges";
import { flattenToRings, isPointInRegion } from "@/modules/evidence/utils/regionPointFilter";
import RegionOccurrenceMap, { type OccurrencePoint } from "./RegionOccurrenceMap";
import type { ChecklistRegion } from "../SpeciesPanel";

interface EvidencePanelProps {
  species: Species;
  checklistId: string;
  region?: ChecklistRegion;
}

const REVISION_FLAG: Record<string, string> = {
  accepted: "Accepted",
  synonym: "Synonym",
  doubtful: "Doubtful",
  none: "Historical name",
};

export default function EvidencePanel({ species, checklistId, region }: EvidencePanelProps) {
  const { evidence, refresh, setSource } = useEvidencePanel(checklistId, species.id, region?.gadmId);
  const sources = evidence?.sources ?? [];
  const revisions = evidence?.revisions ?? [];

  const boundaryQuery = useRegionBoundary(
    region ? { gadmId: region.gadmId, osmType: region.osmType, osmId: region.osmId } : null,
  );
  const gbifQuery = useSpeciesOccurrences(species.gbif_taxon_key, region?.gadmId);
  const isAves = species.class?.toLowerCase() === "aves";
  const ebirdQuery = useEbirdOccurrences(
    species.scientific_name,
    {
      region_country: region?.country,
      region_state: region?.state,
      region_district: region?.district,
    },
    { enabled: isAves },
  );
  const inatQuery = useInatOccurrences(species.scientific_name, {
    region_name: region?.name,
    region_country: region?.country,
    region_state: region?.state,
    region_district: region?.district,
  });

  // Local, ephemeral map filter — which sources currently contribute to the
  // map. `null` means "everything visible" (the default, before the user has
  // touched any checkbox); this is NOT persisted and resets on reload, unlike
  // discard/restore below.
  const [visibleSources, setVisibleSources] = useState<Set<string> | null>(null);
  const [focusedOccurrenceKey, setFocusedOccurrenceKey] = useState<string | null>(null);
  const [infoOpenForSource, setInfoOpenForSource] = useState<string | null>(null);

  function isVisible(source: string): boolean {
    return visibleSources === null || visibleSources.has(source);
  }
  function toggleVisible(source: string) {
    setVisibleSources((prev) => {
      const next = new Set(prev ?? sources.map((s) => s.source));
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  const gbifVisible = isVisible("gbif");
  const ebirdVisible = isVisible("ebird");
  const inatVisible = isVisible("inaturalist");

  const mapPoints = useMemo<OccurrencePoint[]>(() => {
    const points: OccurrencePoint[] = [];
    if (gbifVisible) {
      for (const p of gbifQuery.data ?? []) {
        points.push({
          key: `gbif:${p.key}`,
          source: "gbif",
          lat: p.lat,
          lng: p.lng,
          link: `https://www.gbif.org/occurrence/${p.key}`,
        });
      }
    }
    if (ebirdVisible) {
      for (const p of ebirdQuery.data ?? []) {
        points.push({
          key: `ebird:${p.subId}`,
          source: "ebird",
          lat: p.lat,
          lng: p.lng,
          link: `https://ebird.org/checklist/${p.subId}`,
        });
      }
    }
    if (inatVisible) {
      for (const p of inatQuery.data ?? []) {
        points.push({
          key: `inaturalist:${p.id}`,
          source: "inaturalist",
          lat: p.lat,
          lng: p.lng,
          link: `https://www.inaturalist.org/observations/${p.id}`,
        });
      }
    }
    return points;
  }, [gbifVisible, ebirdVisible, inatVisible, gbifQuery.data, ebirdQuery.data, inatQuery.data]);

  const anySourceVisible = sources.some((s) => s.status !== "discarded" && isVisible(s.source));

  const isLoadingMap =
    boundaryQuery.isLoading ||
    (gbifVisible && gbifQuery.isLoading) ||
    (ebirdVisible && ebirdQuery.isLoading) ||
    (inatVisible && inatQuery.isLoading);

  // Per-source inside/outside-region breakdown for the Evidence Sources list
  // — independent of the map's visibility checkboxes, since this should
  // reflect what was actually fetched, not what's currently toggled on.
  const regionCountsBySource = useMemo(() => {
    const rings = boundaryQuery.data?.geometry ? flattenToRings(boundaryQuery.data.geometry) : [];
    if (rings.length === 0) return null;
    const counts: Record<string, { inside: number; outside: number }> = {};
    const tally = (source: string, points: Array<{ lat: number; lng: number }>) => {
      let inside = 0;
      let outside = 0;
      for (const p of points) {
        if (isPointInRegion(p.lng, p.lat, rings)) inside++;
        else outside++;
      }
      counts[source] = { inside, outside };
    };
    if (gbifQuery.data) tally("gbif", gbifQuery.data);
    if (ebirdQuery.data) tally("ebird", ebirdQuery.data);
    if (inatQuery.data) tally("inaturalist", inatQuery.data);
    return counts;
  }, [boundaryQuery.data, gbifQuery.data, ebirdQuery.data, inatQuery.data]);

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
      <section>
        <RegionOccurrenceMap
          boundary={boundaryQuery.data?.geometry ?? null}
          isApproximate={boundaryQuery.data?.source === "bbox"}
          points={mapPoints}
          emphasizeBoundary={anySourceVisible}
          focusedKey={focusedOccurrenceKey}
          onHoverPoint={setFocusedOccurrenceKey}
          onClickPoint={(point) => window.open(point.link, "_blank", "noopener")}
          isLoading={isLoadingMap}
        />
      </section>

      <div className="space-y-6">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
              Evidence Sources
            </h3>
            <button
              className="text-brand text-[10px] font-bold mono-text uppercase hover:underline disabled:opacity-50"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || !species.gbif_taxon_key}
            >
              {refresh.isPending ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {sources.length === 0 && (
            <p className="text-xs text-slate-400">No evidence sources recorded yet.</p>
          )}

          <div className="divide-y divide-surface-dim border-t border-b border-surface-dim">
            {sources.map((source) => {
              const discarded = source.status === "discarded";
              const checked = !discarded && isVisible(source.source);
              const focused = !discarded && focusedOccurrenceKey?.startsWith(`${source.source}:`);
              // eBird's persisted record_count comes from a whole-region recent-
              // observations call (1 API call for the entire checklist refresh,
              // see ebirdProvider.ts) which the eBird API collapses to ~1 row per
              // species — it understates real activity. The per-species fetch
              // already made for this one species' map (ebirdQuery) doesn't have
              // that problem, so prefer it here once it's loaded.
              const displayCount =
                source.source === "ebird" && ebirdQuery.data ? ebirdQuery.data.length : source.record_count;
              return (
                <div
                  key={source.source}
                  className={`flex items-center gap-3 py-2 ${focused ? "bg-brand/5" : ""} ${discarded ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={discarded}
                    onChange={() => toggleVisible(source.source)}
                    className="accent-brand"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold mono-text ${discarded ? "line-through text-slate-400" : ""}`}>
                      {source.source_link ? (
                        <a href={source.source_link} target="_blank" rel="noreferrer" className="hover:text-brand">
                          {EVIDENCE_SOURCE_LABELS[source.source] ?? source.source}
                        </a>
                      ) : (
                        EVIDENCE_SOURCE_LABELS[source.source] ?? source.source
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 mono-text relative inline-flex items-center gap-1">
                      <span>
                        {displayCount ?? "N/A"} occurrences
                        {source.unique_count != null ? ` · ${source.unique_count} unique` : ""}
                        {source.reference_text ? ` · ${source.reference_text}` : ""}
                      </span>
                      {source.source === "ebird" && displayCount === 0 && (
                        <>
                          <button
                            type="button"
                            aria-label="Why is the eBird occurrence count 0?"
                            className="material-symbols-outlined text-slate-400 hover:text-brand"
                            style={{ fontSize: "12px" }}
                            onClick={() =>
                              setInfoOpenForSource((prev) => (prev === source.source ? null : source.source))
                            }
                          >
                            info
                          </button>
                          {infoOpenForSource === source.source && (
                            <span className="absolute left-0 top-full mt-1 z-10 w-64 p-2 border border-surface-dim bg-surface-container-low text-[9px] text-slate-500 normal-case shadow-md">
                              &quot;eBird source, 0 occurrences&quot; means this bird has historical records in
                              eBird for this region, but none in the last 30 days — eBird&apos;s public API only
                              exposes a 30-day recent-observations window, not all-time counts.
                            </span>
                          )}
                        </>
                      )}
                    </p>
                    {regionCountsBySource?.[source.source] && (
                      <p className="text-[9px] text-slate-400 mono-text">
                        {regionCountsBySource[source.source].inside} inside region ·{" "}
                        {regionCountsBySource[source.source].outside} outside region
                      </p>
                    )}
                  </div>
                  <button
                    className="text-[9px] font-bold mono-text uppercase text-slate-400 hover:text-brand disabled:opacity-50"
                    disabled={setSource.isPending}
                    onClick={() =>
                      setSource.mutate({ action: discarded ? "restore" : "discard", source: source.source })
                    }
                  >
                    {discarded ? "Restore" : "Discard"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {species.publications && species.publications.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">menu_book</span>
              <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                Literature Sources
              </h3>
            </div>
            <ul className="space-y-1.5 divide-y divide-surface-dim">
              {species.publications.map((pub) => (
                <li key={pub.id} className="pt-1.5 first:pt-0">
                  <p className="text-xs font-bold mono-text">
                    {pub.link ? (
                      <a href={pub.link} target="_blank" rel="noreferrer" className="hover:text-brand">
                        {pub.title}
                      </a>
                    ) : (
                      pub.title
                    )}
                  </p>
                  <p className="text-[10px] text-slate-500 mono-text">
                    {[pub.authors?.join(", "), pub.year].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {evidence?.occurrence_count != null && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">travel_explore</span>
              <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                GBIF Occurrence Count
              </h3>
            </div>
            <div className="space-y-1.5 mono-text text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-400 uppercase tracking-widest text-[8px]">
                  {region ? "Inside Region" : "Worldwide"}
                </span>
                <span className="font-bold">{evidence.occurrence_count.toLocaleString()}</span>
              </div>
              {evidence.occurrence_count_outside_region != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400 uppercase tracking-widest text-[8px]">Outside Region</span>
                  <span className="font-bold">{evidence.occurrence_count_outside_region.toLocaleString()}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {evidence?.basis_of_record_breakdown && Object.keys(evidence.basis_of_record_breakdown).length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">bar_chart</span>
              <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                Evidence Strength
              </h3>
            </div>
            <div className="space-y-1.5 mono-text text-[10px]">
              {Object.entries(evidence.basis_of_record_breakdown).map(([basis, count]) => (
                <div key={basis} className="flex justify-between">
                  <span className="text-slate-400 uppercase tracking-widest text-[8px]">
                    {basis.replace(/_/g, " ")}
                  </span>
                  <span className="font-bold">{count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {revisions.length > 1 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">history</span>
              <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                Taxonomic Revisions
              </h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-2 normal-case">
              This taxon has been revised in the GBIF backbone. Occurrence counts for each
              historical/synonym name are kept separate and are not merged automatically.
            </p>
            <div className="space-y-2">
              {revisions.map((revision, index) => {
                const total = Object.values(revision.occurrenceCounts ?? {}).reduce(
                  (sum, n) => sum + (n ?? 0),
                  0,
                );
                return (
                  <div key={`${revision.taxonKey}-${index}`} className="p-2 border border-surface-dim">
                    <div className="flex items-center justify-between">
                      <p className="mono-text text-xs italic font-bold">{revision.scientificName}</p>
                      <span className="font-label-caps text-[8px] uppercase tracking-widest text-slate-400">
                        {REVISION_FLAG[revision.status] ?? revision.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mono-text uppercase mt-1">
                      Occurrences: {total}
                      {revision.taxonKey != null ? ` · Taxon Key: ${revision.taxonKey}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {evidence?.external_ids && Object.keys(evidence.external_ids).length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-slate-500 text-sm">link</span>
              <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                External IDs
              </h3>
            </div>
            <div className="space-y-1.5 mono-text text-[10px]">
              {Object.entries(evidence.external_ids).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-slate-400 uppercase tracking-widest text-[8px]">{key}</span>
                  <span className="font-bold">{String(value)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
