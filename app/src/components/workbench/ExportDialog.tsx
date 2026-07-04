"use client";

import { useState } from "react";
import type { Species } from "@/types/species.types";
import {
  EXPORT_FIELDS,
  EXPORT_FIELD_LABELS,
  exportSpecies,
  type ExportField,
  type ExportFormat,
} from "@/modules/checklist/utils/exportSpecies";

interface ExportDialogProps {
  species: Species[];
  fileBaseName: string;
  onClose: () => void;
}

export default function ExportDialog({ species, fileBaseName, onClose }: ExportDialogProps) {
  const [selectedFields, setSelectedFields] = useState<Set<ExportField>>(new Set(EXPORT_FIELDS));
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);

  function toggleField(field: ExportField) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleExport() {
    if (selectedFields.size === 0) return;
    setIsExporting(true);
    try {
      await exportSpecies(species, [...selectedFields], format, fileBaseName);
      onClose();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[26rem] max-w-[90vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Export Species</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-4">
          Exports the {species.length} species currently visible in the table.
        </p>

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Fields</h4>
        <div className="flex flex-col gap-1.5 mb-4">
          {EXPORT_FIELDS.map((field) => (
            <label
              key={field}
              className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedFields.has(field)}
                onChange={() => toggleField(field)}
                className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
              />
              {EXPORT_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
        {selectedFields.size === 0 && (
          <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-2 py-1.5 mb-4">
            Select at least one field.
          </p>
        )}

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Format</h4>
        <div className="flex items-center gap-4 mb-5">
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="export-format"
              checked={format === "csv"}
              onChange={() => setFormat("csv")}
            />
            CSV
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="export-format"
              checked={format === "excel"}
              onChange={() => setFormat("excel")}
            />
            Excel
          </label>
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed mb-5 -mt-3">
          Excel exports color each row by taxonomy status (red = conflict, yellow = synonym/unresolved, green =
          accepted) with a Legend sheet — CSV is plain text and can&apos;t carry color.
        </p>

        <button
          onClick={handleExport}
          disabled={selectedFields.size === 0 || isExporting}
          className="w-full bg-brand text-white mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? "Exporting…" : "Export"}
        </button>
      </div>
    </div>
  );
}
