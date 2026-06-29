"use client";

import { useEffect, useState } from "react";
import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { useSpeciesInventory, type ProviderProgress } from "@/modules/evidence/hooks/useSpeciesInventory";
import { EVIDENCE_PROVIDERS } from "@/modules/evidence/discovery/registry";
import type { RawSpeciesRecord, SourceKey, SourceSummary } from "@/modules/evidence/discovery/types";
import { SOURCE_ACCENT, SOURCE_BG_TINT, SOURCE_TEXT_COLOR } from "@/modules/evidence/discovery/sourceColors";
import { withLiteratureDateRange } from "@/modules/research/services/literatureCandidatePool";
import { PriorChecklistBanner, deepestTaxonName } from "./SpeciesInventoryPanel";
import { SourceCreditLinks } from "./SourceCreditLinks";

export interface SpeciesInventorySummaryProps {
  taxonomicScope: TaxonomicScope;
  deepestTaxonKey: number | null;
  region: RegionValue;
  /** Restricts discovery to this subset of sources; omit to query everything (default). */
  enabledSources?: Set<SourceKey>;
  /** Species "Added" from the Deep Search dialog — merged into the same aggregation pass as discovered evidence (see useSpeciesInventory). */
  literatureRecords?: RawSpeciesRecord[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: "",
  empty: "no records",
  disabled: "unavailable",
  error: "error",
};

/**
 * Compact species-inventory summary for Step 2 (Import): total species count,
 * resolved-to-backbone count, and a per-source evidence summary. The full
 * species list + source presence matrix is shown in Step 3 (Validate) via
 * SpeciesInventoryPanel.
 */
export function SpeciesInventorySummary({
  taxonomicScope,
  deepestTaxonKey,
  region,
  enabledSources,
  literatureRecords,
}: SpeciesInventorySummaryProps) {
  const inventory = useSpeciesInventory(taxonomicScope, deepestTaxonKey, region, enabledSources, literatureRecords);

  if (deepestTaxonKey === null) {
    return (
      <p className="text-sm text-on-surface-variant">
        Select a taxonomic scope in Step 1 to discover a species inventory for this region.
      </p>
    );
  }

  if (inventory.isLoading) {
    return (
      <DiscoveryLoadingPanel providers={inventory.providers} region={region} />
    );
  }

  if (inventory.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to build species inventory: {(inventory.error as Error).message}
      </p>
    );
  }

  const data = inventory.data!;

  return (
    <div className="flex flex-col gap-sm">
      <div className="space-y-xs">
        <h3 className="font-headline-md text-[13px] font-bold text-on-surface">Species Inventory</h3>
        <p className="text-xs text-on-surface-variant">
          Aggregated evidence across{" "}
          <SourceCreditLinks
            sources={EVIDENCE_PROVIDERS.map((p) => p.key)}
            labels={Object.fromEntries(EVIDENCE_PROVIDERS.map((p) => [p.key, p.label])) as Record<SourceKey, string>}
          />
          , normalized against the local GBIF backbone. Full species list and source matrix are shown in the Validate
          step.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Species" value={data.totalSpecies} highlight />
        {withLiteratureDateRange(data.sourceSummary, literatureRecords).map((s) => (
          <SourceStat key={s.source} summary={s} />
        ))}
      </div>

      <PriorChecklistBanner
        priorChecklists={data.priorChecklists}
        taxonGroup={deepestTaxonName(taxonomicScope)}
        regionName={region.region_name}
      />
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div
      className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${
        highlight ? "bg-primary-container/20" : "bg-surface"
      }`}
    >
      <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">{label}</span>
      <span className="font-code-md text-[14px] font-bold text-on-surface">{value}</span>
    </div>
  );
}

/** Cycling verbs shown in the loading heading, swapped every few seconds with a fade. */
const SCAN_VERBS = ["Fetching", "Scouring", "Searching", "Gathering", "Compiling"];

const PROVIDER_STATUS_NOTE: Record<string, string> = {
  ok: "found records",
  empty: "no records found",
  disabled: "unavailable",
  error: "error",
};

function DiscoveryLoadingPanel({
  providers,
  region,
}: {
  providers: ProviderProgress[];
  region: RegionValue;
}) {
  const [verbIndex, setVerbIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      const timeout = setTimeout(() => {
        setVerbIndex((i) => (i + 1) % SCAN_VERBS.length);
        setFade(true);
      }, 200);
      return () => clearTimeout(timeout);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="space-y-xs mb-sm">
        <h3 className="font-headline-md text-[13px] font-bold text-primary">
          <span className={`inline-block transition-opacity duration-200 ${fade ? "opacity-100" : "opacity-0"}`}>
            {SCAN_VERBS[verbIndex]}
          </span>{" "}
          occurrence data...
        </h3>
        <p className="text-xs text-on-surface-variant">
          Checking historical checklists and occurrence records
          {region.region_name ? ` for ${region.region_name}` : ""}
          {region.region_gadm_id ? ` (${region.region_gadm_id})` : ""}.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-outline-variant/40 ml-1">
        {providers.map((p) => (
          <ProviderProgressRow key={p.source} progress={p} />
        ))}
      </div>
    </div>
  );
}

function ProviderProgressRow({ progress }: { progress: ProviderProgress }) {
  const accent = SOURCE_ACCENT[progress.source as keyof typeof SOURCE_ACCENT] ?? "";
  const isDone = progress.state === "done";
  const status = progress.run?.status;

  let icon = "progress_activity";
  let iconClass = "text-primary animate-spin";
  let note = "in progress...";

  if (isDone) {
    note = (status && PROVIDER_STATUS_NOTE[status]) ?? "done";
    if (status === "ok") {
      icon = "check_circle";
      iconClass = "text-green-600";
    } else if (status === "error") {
      icon = "error";
      iconClass = "text-red-600";
    } else {
      icon = "remove_circle_outline";
      iconClass = "text-on-surface-variant/60";
    }
  }

  return (
    <div className={`flex items-center gap-2 py-1.5 px-3 bg-surface border border-outline-variant/30 rounded-sm ${accent}`}>
      <span className={`material-symbols-outlined text-[16px] ${iconClass}`}>{icon}</span>
      <span className="font-code-md text-[12px] text-on-surface">{progress.label}</span>
      <span className="font-code-md text-[11px] text-on-surface-variant ml-auto" title={progress.run?.message}>
        {note}
      </span>
    </div>
  );
}

function SourceStat({ summary }: { summary: SourceSummary }) {
  const statusNote = STATUS_LABEL[summary.status];
  const key = summary.source as keyof typeof SOURCE_ACCENT;
  const accent = SOURCE_ACCENT[key] ?? "";
  const tint = SOURCE_BG_TINT[key] ?? "bg-surface";
  const textColor = SOURCE_TEXT_COLOR[key] ?? "text-on-surface";
  return (
    <div
      className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${tint} ${accent}`}
      title={summary.message}
    >
      <span className={`font-label-caps text-[9px] uppercase tracking-wider ${textColor}`}>
        {summary.label}
        {statusNote && ` · ${statusNote}`}
      </span>
      <span className="font-code-md text-[14px] font-bold text-on-surface">
        {summary.status === "disabled" || summary.status === "error" ? "—" : summary.speciesCount}
      </span>
      {summary.totalOccurrences > 0 && (
        <span className="font-code-md text-[10px] text-on-surface-variant">
          {summary.totalOccurrences} {summary.occurrenceLabel}
        </span>
      )}
    </div>
  );
}
