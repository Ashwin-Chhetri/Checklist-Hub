"use client";

import { useEffect, useMemo, useState } from "react";
import type { Checklist } from "@/types/checklist.types";
import type { Species } from "@/types/species.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { SpeciesUploadDropzone } from "@/components/checklist-wizard/step2/SpeciesUploadDropzone";
import { UploadIssuesList } from "@/components/checklist-wizard/step2/UploadIssuesList";
import { ExpectedColumnsHelp } from "@/components/checklist-wizard/step2/ExpectedColumnsHelp";
import { SpeciesInventoryPanel } from "@/components/checklist-wizard/step2/discovery/SpeciesInventoryPanel";
import { mergeParsedFiles, type ParsedFileResult, type ParsedSpeciesRow } from "@/modules/checklist/utils/speciesFileParser";
import { EVIDENCE_PROVIDERS } from "@/modules/evidence/discovery/registry";
import type { SourceKey } from "@/modules/evidence/discovery/types";
import { matchSpeciesName } from "@/modules/taxonomy/services/taxonomyApi";
import { useAddSpeciesToChecklist } from "@/modules/species/hooks/useAddSpeciesToChecklist";

interface AddSpeciesDialogProps {
  checklist: Checklist;
  existingSpecies: Species[];
  onClose: () => void;
}

type Step = "sources" | "review";

const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

function deepestScopeName(checklist: Checklist): string | null {
  const scope = checklist.taxonomic_scope ?? {};
  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    const value = scope[RANKS[i]];
    if (value) return value;
  }
  return null;
}

function regionValueFromChecklist(checklist: Checklist): RegionValue {
  return {
    region_name: checklist.region_name ?? "",
    region_district: checklist.region_district ?? checklist.region_name ?? "",
    region_state: checklist.region_state ?? "",
    region_country: checklist.region_country ?? "",
    region_gadm_id: checklist.region_gadm_id ?? "",
    region_pin: checklist.region_pin ?? "",
  };
}

export default function AddSpeciesDialog({ checklist, existingSpecies, onClose }: AddSpeciesDialogProps) {
  const [step, setStep] = useState<Step>("sources");
  const [deepestTaxonKey, setDeepestTaxonKey] = useState<number | null>(null);
  const [enabledSources, setEnabledSources] = useState<Set<SourceKey>>(
    () => new Set(EVIDENCE_PROVIDERS.map((p) => p.key)),
  );
  const [uploadedFiles, setUploadedFiles] = useState<ParsedFileResult[]>([]);
  const { rows: csvRows, issues: importIssues } = useMemo(() => mergeParsedFiles(uploadedFiles), [uploadedFiles]);
  const [discoverySelection, setDiscoverySelection] = useState<Map<string, ParsedSpeciesRow>>(new Map());
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const region = useMemo(() => regionValueFromChecklist(checklist), [checklist]);
  const taxonomicScope = checklist.taxonomic_scope ?? {};

  // Resolve the checklist's stored deepest taxon name to a GBIF usageKey once on
  // open — the numeric key used at creation time isn't persisted on Checklist.
  useEffect(() => {
    const name = deepestScopeName(checklist);
    if (!name) return;
    let cancelled = false;
    matchSpeciesName(name)
      .then((match) => {
        if (!cancelled) setDeepestTaxonKey(match.acceptedUsageKey ?? match.usageKey);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checklist]);

  const existingNames = useMemo(
    () => new Set(existingSpecies.map((s) => s.scientific_name.trim().toLowerCase())),
    [existingSpecies],
  );
  const existingKeys = useMemo(
    () => new Set(existingSpecies.map((s) => s.gbif_taxon_key).filter((k): k is number => k != null)),
    [existingSpecies],
  );

  function isAlreadyInChecklist(r: ParsedSpeciesRow): boolean {
    const nameMatch = existingNames.has(r.scientific_name.trim().toLowerCase());
    const keyMatch = r.gbif_taxon_key != null && existingKeys.has(r.gbif_taxon_key);
    return nameMatch || keyMatch;
  }

  // CSV rows skip SpeciesInventoryPanel's own dedup (that only covers discovered
  // species), so filter them against the checklist's existing species here too —
  // only new species ever reach mergedRows/the Import count.
  const newCsvRows = useMemo(() => csvRows.filter((r) => !isAlreadyInChecklist(r)), [csvRows, existingNames, existingKeys]);
  const csvDuplicateCount = csvRows.length - newCsvRows.length;

  const mergedRows = useMemo<ParsedSpeciesRow[]>(() => {
    const map = new Map<string, ParsedSpeciesRow>();
    for (const row of newCsvRows) {
      map.set(row.scientific_name.trim().toLowerCase(), row);
    }
    for (const [key, row] of discoverySelection) {
      if (!map.has(key)) map.set(key, row);
    }
    return Array.from(map.values());
  }, [newCsvRows, discoverySelection]);

  const addSpecies = useAddSpeciesToChecklist(checklist.id);

  function toggleSource(key: SourceKey) {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleImport() {
    addSpecies.mutate(mergedRows, {
      onSuccess: (res) => setResult({ added: res.added, skipped: res.skipped }),
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Add Species</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-on-surface">
              Imported <span className="font-bold text-primary">{result.added}</span> species.
              {result.skipped > 0 && (
                <span className="text-on-surface-variant"> {result.skipped} already in the checklist were skipped.</span>
              )}
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn-primary">
                Done
              </button>
            </div>
          </div>
        ) : step === "sources" ? (
          <div className="flex flex-col gap-lg">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">Sources</h4>
              <div className="flex flex-wrap gap-3">
                {EVIDENCE_PROVIDERS.map((provider) => (
                  <label key={provider.key} className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledSources.has(provider.key)}
                      onChange={() => toggleSource(provider.key)}
                      className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
                    />
                    {provider.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-lg">
              <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Upload Species List
              </h4>
              <SpeciesUploadDropzone
                onFilesAdded={(files) => setUploadedFiles((prev) => [...prev, ...files])}
              />
              <ExpectedColumnsHelp />
              {uploadedFiles.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {uploadedFiles.map((file, i) => (
                    <li
                      key={`${file.fileName}-${i}`}
                      className="flex items-center gap-2 text-sm text-on-surface border border-surface-dim bg-white px-2 py-1.5"
                    >
                      <span className="material-symbols-outlined text-[18px] text-primary shrink-0">task</span>
                      <span className="font-bold truncate">{file.fileName}</span>
                      <span className="text-on-surface-variant shrink-0">— {file.rows.length} species detected</span>
                      <button
                        type="button"
                        onClick={() => setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="ml-auto shrink-0 text-on-surface-variant hover:text-red-600 transition-colors"
                        aria-label={`Remove ${file.fileName}`}
                        title={`Remove ${file.fileName}`}
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <UploadIssuesList issues={importIssues} />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm border border-surface-dim hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep("review")}
                disabled={enabledSources.size === 0 && csvRows.length === 0}
                className="bg-brand text-white mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
              >
                Fetch Species
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-lg">
            <button
              onClick={() => setStep("sources")}
              className="flex items-center gap-1 text-[10px] font-bold uppercase text-on-surface-variant hover:text-brand w-fit"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span> Back to Sources
            </button>

            <SpeciesInventoryPanel
              taxonomicScope={taxonomicScope}
              deepestTaxonKey={deepestTaxonKey}
              region={region}
              selected={discoverySelection}
              onSelectionChange={setDiscoverySelection}
              enabledSources={enabledSources}
              excludeTaxonKeys={existingKeys}
              excludeNames={existingNames}
              uploadedRows={newCsvRows}
            />

            {csvDuplicateCount > 0 && (
              <p className="text-xs text-on-surface-variant">
                {csvDuplicateCount} uploaded row{csvDuplicateCount === 1 ? "" : "s"} already in this checklist{" "}
                {csvDuplicateCount === 1 ? "was" : "were"} excluded.
              </p>
            )}

            {addSpecies.isError && <p className="text-xs text-red-600">{(addSpecies.error as Error).message}</p>}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm border border-surface-dim hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={mergedRows.length === 0 || addSpecies.isPending}
                className="bg-brand text-white mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
              >
                {addSpecies.isPending ? "Importing..." : `Import (${mergedRows.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
