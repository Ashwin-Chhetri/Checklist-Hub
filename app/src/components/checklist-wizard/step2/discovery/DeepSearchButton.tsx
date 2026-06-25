"use client";

import { useState } from "react";
import type { RawSpeciesRecord } from "@/modules/evidence/discovery/types";
import { DeepSearchDialog } from "./DeepSearchDialog";

interface DeepSearchButtonProps {
  region: string;
  taxonGroup: string;
  /** Pushes a finished run's extracted species into the candidate species pool — see SpeciesDiscoveryPanel/page.tsx's literatureRecords state. */
  onAddLiterature: (records: RawSpeciesRecord[]) => void;
  /** The in-flight/completed run for this region+taxon, owned by the wizard page (and persisted to the draft) — survives this button's own dialog being closed and re-opened, or the wizard navigating to another step and back. Null before any run has been started. */
  runId: string | null;
  onRunIdChange: (runId: string | null) => void;
}

/** Opens DeepSearchDialog for the region+taxon already selected in Step 1. Disabled until both are known. */
export function DeepSearchButton({ region, taxonGroup, onAddLiterature, runId, onRunIdChange }: DeepSearchButtonProps) {
  const [open, setOpen] = useState(false);
  const disabled = !region || !taxonGroup;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Select a region and taxonomic scope in Step 1 first." : undefined}
        className="flex items-center gap-1.5 mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm border border-outline-variant hover:bg-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed w-fit"
      >
        <span className="material-symbols-outlined text-[16px] text-primary">travel_explore</span>
        {runId ? "Resume Deep Literature Search" : "Run Deep Literature Search"}
      </button>

      {open && (
        <DeepSearchDialog
          region={region}
          taxonGroup={taxonGroup}
          onClose={() => setOpen(false)}
          onAdd={onAddLiterature}
          runId={runId}
          onRunIdChange={onRunIdChange}
        />
      )}
    </>
  );
}
