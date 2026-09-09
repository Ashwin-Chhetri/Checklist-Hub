"use client";

import type { RefObject } from "react";
import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { SpeciesUploadDropzone } from "@/components/checklist-wizard/step2/SpeciesUploadDropzone";
import { UploadIssuesList } from "@/components/checklist-wizard/step2/UploadIssuesList";
import { ExpectedColumnsHelp } from "@/components/checklist-wizard/step2/ExpectedColumnsHelp";
import type { ParsedFileResult, ParsedImportIssue } from "@/modules/checklist/utils/speciesFileParser";
import type { RawSpeciesRecord } from "@/modules/evidence/discovery/types";
import { SpeciesInventorySummary } from "./SpeciesInventorySummary";
import { deepestTaxonName } from "./SpeciesInventoryPanel";
import { DeepSearchButton } from "./DeepSearchButton";

export interface SpeciesDiscoveryPanelProps {
  taxonomicScope: TaxonomicScope;
  deepestTaxonKey: number | null;
  region: RegionValue;
  uploadedFiles: ParsedFileResult[];
  onFilesAdded: (files: ParsedFileResult[]) => void;
  onRemoveFile: (index: number) => void;
  importIssues: ParsedImportIssue[];
  literatureRecords: RawSpeciesRecord[];
  onAddLiterature: (records: RawSpeciesRecord[]) => void;
  deepSearchRunId: string | null;
  onDeepSearchRunIdChange: (runId: string | null) => void;
  /** Anchors for the Step 2 guide tour — optional so this panel doesn't need a tour context to render. */
  summaryRef?: RefObject<HTMLDivElement | null>;
  deepSearchRef?: RefObject<HTMLDivElement | null>;
  uploadRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Step 2 (Import) layout: a compact species-inventory summary (total count,
 * resolved count, evidence summary by source) on top, CSV upload below. The
 * full species list with the source presence matrix and selection is shown
 * in Step 3 (Validate) via SpeciesInventoryPanel.
 */
export function SpeciesDiscoveryPanel({
  taxonomicScope,
  deepestTaxonKey,
  region,
  uploadedFiles,
  onFilesAdded,
  onRemoveFile,
  importIssues,
  literatureRecords,
  onAddLiterature,
  deepSearchRunId,
  onDeepSearchRunIdChange,
  summaryRef,
  deepSearchRef,
  uploadRef,
}: SpeciesDiscoveryPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div ref={summaryRef}>
        <SpeciesInventorySummary
          taxonomicScope={taxonomicScope}
          deepestTaxonKey={deepestTaxonKey}
          region={region}
          literatureRecords={literatureRecords}
        />
      </div>

      <div ref={deepSearchRef}>
        <DeepSearchButton
          region={region.region_name}
          taxonGroup={deepestTaxonName(taxonomicScope) ?? ""}
          onAddLiterature={onAddLiterature}
          runId={deepSearchRunId}
          onRunIdChange={onDeepSearchRunIdChange}
        />
      </div>

      <div className="h-px bg-outline-variant" />

      <div ref={uploadRef} className="flex flex-col gap-3">
        <h3 className="font-headline-md text-[13px] font-bold text-on-surface">UPLOAD SPECIES LIST</h3>
        <SpeciesUploadDropzone onFilesAdded={onFilesAdded} compact />
        <ExpectedColumnsHelp compact />
        {uploadedFiles.length > 0 && (
          <ul className="flex flex-col gap-1">
            {uploadedFiles.map((file, i) => (
              <li
                key={`${file.fileName}-${i}`}
                className="flex items-center gap-2 text-xs text-on-surface border border-outline-variant bg-white px-2 py-1.5"
              >
                <span className="material-symbols-outlined text-[16px] text-primary shrink-0">task</span>
                <span className="font-bold truncate">{file.fileName}</span>
                <span className="text-on-surface-variant shrink-0">— {file.rows.length} species detected</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(i)}
                  className="ml-auto shrink-0 text-on-surface-variant hover:text-red-600 transition-colors"
                  aria-label={`Remove ${file.fileName}`}
                  title={`Remove ${file.fileName}`}
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <UploadIssuesList issues={importIssues} />
      </div>
    </div>
  );
}
