"use client";

import { useState } from "react";
import type { ParsedImportIssue } from "@/modules/checklist/utils/speciesFileParser";

const ISSUE_LABELS: Record<ParsedImportIssue["issue_type"], string> = {
  duplicate_id: "Duplicate ID",
  extralimital: "Extra-limital",
  taxonomic_conflict: "Taxonomic conflict",
  synonym: "Synonym",
  geospatial: "Geospatial",
  malformed_row: "Malformed row",
  invalid_date: "Invalid date",
  invalid_count: "Invalid count",
  missing_name: "Missing name",
  duplicate_row: "Duplicate row",
};

/** Inline list of parser-detected issues, grouped by type, shown directly under the upload dropzone. */
export function UploadIssuesList({ issues }: { issues: ParsedImportIssue[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (issues.length === 0) return null;

  const grouped = new Map<ParsedImportIssue["issue_type"], ParsedImportIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.issue_type) ?? [];
    list.push(issue);
    grouped.set(issue.issue_type, list);
  }

  function toggle(type: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <div className="border border-outline-variant bg-white flex flex-col">
      <div className="bg-surface-container-low border-b border-outline-variant px-4 py-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">warning</span>
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">
          {issues.length} issue{issues.length === 1 ? "" : "s"} found during import
        </span>
      </div>
      <div className="divide-y divide-outline-variant">
        {[...grouped.entries()].map(([type, group]) => {
          const isOpen = expanded.has(type);
          return (
            <div key={type}>
              <button
                type="button"
                onClick={() => toggle(type)}
                className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant chevron-icon">
                  {isOpen ? "expand_more" : "chevron_right"}
                </span>
                <span className="text-sm font-bold">{ISSUE_LABELS[type]}</span>
                <span className="font-code-md text-[11px] text-on-surface-variant">
                  ({group.length})
                </span>
              </button>
              {isOpen && (
                <ul className="px-4 pb-2 flex flex-col gap-1">
                  {group.map((issue, i) => (
                    <li
                      key={i}
                      className="font-code-md text-[12px] text-on-surface-variant flex gap-2"
                    >
                      {issue.row > 0 && <span className="text-primary font-bold">Row {issue.row}:</span>}
                      <span>{issue.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
