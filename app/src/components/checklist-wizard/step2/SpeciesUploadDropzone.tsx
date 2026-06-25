"use client";

import { useRef, useState } from "react";
import { parseSpeciesFilesIndividually, type ParsedFileResult } from "@/modules/checklist/utils/speciesFileParser";

export interface SpeciesUploadDropzoneProps {
  /** Reports each dropped/selected file's own parse result, so the caller can list and remove them individually. */
  onFilesAdded: (files: ParsedFileResult[]) => void;
  /** Smaller typeface/spacing for use in compact contexts (e.g. the wizard's Import step). */
  compact?: boolean;
}

/** Drag-and-drop / browse uploader for species list files (CSV, TSV, JSON, Excel), fault-tolerant via parseSpeciesFilesIndividually. */
export function SpeciesUploadDropzone({ onFilesAdded, compact = false }: SpeciesUploadDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  async function processFiles(files: File[]) {
    if (files.length === 0) return;
    setIsParsing(true);
    setError(null);
    try {
      const results = await parseSpeciesFilesIndividually(files);
      const isEmpty = results.every((r) => r.rows.length === 0 && r.issues.length === 0);
      if (isEmpty) {
        setError("No valid rows found. Make sure the file has a Scientific Name column.");
        return;
      }
      onFilesAdded(results);
    } finally {
      setIsParsing(false);
    }
  }

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) void processFiles(files);
      }}
      className={`border-2 border-dashed bg-white flex flex-col items-center justify-center cursor-pointer transition-colors ${
        compact ? "gap-1 py-6" : "gap-2 py-12"
      } ${isDragOver ? "border-primary" : "border-outline-variant hover:border-primary"}`}
    >
      <span className={`material-symbols-outlined text-on-surface-variant ${compact ? "text-[28px]" : "text-[40px]"}`}>
        upload_file
      </span>
      <p className={`${compact ? "text-xs" : "text-sm"} text-on-surface-variant`}>
        {isParsing ? "Parsing…" : "Drag and drop CSV, TSV, JSON, or Excel files here"}
      </p>
      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
        Max 50MB per file · multiple files supported
      </p>
      <button
        type="button"
        className={`bg-primary text-on-primary font-label-caps hard-shadow disabled:opacity-50 ${
          compact ? "mt-1 px-3 py-1.5 text-[10px]" : "mt-2 px-4 py-2 text-[11px]"
        }`}
        disabled={isParsing}
        onClick={(e) => {
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
      >
        BROWSE FILES
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.json,.xlsx,.xls,text/csv,application/json"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void processFiles(files);
          e.target.value = "";
        }}
      />
      {error && <p className={`${compact ? "text-xs" : "text-sm"} text-red-600 mt-1`}>{error}</p>}
    </div>
  );
}
