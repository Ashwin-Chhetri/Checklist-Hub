import type { Species } from "@/types/species.types";
import { EVIDENCE_QUALITY_STYLES, REVIEW_STATUS_STYLES } from "@/modules/editor/utils/badges";
import { citationFor } from "@/modules/publication/utils/checklistStats";

export type ExportField =
  | "scientific_name"
  | "taxonomy_hierarchy"
  | "occurrence"
  | "sources"
  | "evidence"
  | "review";
export type ExportFormat = "csv" | "excel";

export const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  scientific_name: "Scientific Name",
  taxonomy_hierarchy: "Taxonomy Hierarchy",
  occurrence: "Occurrence",
  sources: "Sources",
  evidence: "Evidence",
  review: "Review",
};

export const EXPORT_FIELDS: ExportField[] = [
  "scientific_name",
  "taxonomy_hierarchy",
  "occurrence",
  "sources",
  "evidence",
  "review",
];

// A field may expand into several columns — keeps taxonomic rank columns
// (Kingdom..Genus, Authority, Year) together under one checkbox rather than
// forcing the user to tick six boxes to get a hierarchy at all.
const FIELD_COLUMNS: Record<ExportField, string[]> = {
  scientific_name: ["Scientific Name", "Common Name"],
  taxonomy_hierarchy: ["Kingdom", "Phylum", "Class", "Order", "Family", "Genus", "Authority", "Year Published", "Taxonomy Status"],
  occurrence: ["Occurrence Count"],
  sources: ["Sources (Citations)"],
  evidence: ["Evidence Quality"],
  review: ["Review Status"],
};

/** Fill color (matches the workbench table's row highlight) applied per
 * taxonomy status when exporting to Excel — CSV has no concept of cell
 * color, so this only ever affects the .xlsx path. */
const ROW_FILL_BY_TAXONOMY_STATUS: Partial<Record<Species["taxonomy_status"], string>> = {
  authority_conflict: "FFFEE2E2", // red
  synonym: "FFFEF3C7", // yellow
  unresolved: "FFFEF3C7", // yellow
  accepted: "FFDCFCE7", // green
};

/** Synonym rows may have occurrence_count = 0 because the aggregator only counted
 * accepted records — falls back to summing revisions, mirroring SpeciesRow's display. */
function occurrenceCountOf(species: Species): number {
  const raw = species.evidence?.occurrence_count ?? 0;
  if (raw > 0) return raw;
  return (species.evidence?.revisions ?? []).reduce((sum, r) => {
    return sum + Object.values(r.occurrenceCounts ?? {}).reduce<number>((s, n) => s + (n ?? 0), 0);
  }, 0);
}

function buildHeaders(fields: ExportField[]): string[] {
  return fields.flatMap((f) => FIELD_COLUMNS[f]);
}

function buildRowValues(species: Species, fields: ExportField[], accessDate: Date): (string | number)[] {
  const values: (string | number)[] = [];
  const classification = species.taxonomy?.classification;

  for (const field of fields) {
    switch (field) {
      case "scientific_name":
        values.push(species.scientific_name, species.common_name ?? "");
        break;
      case "taxonomy_hierarchy":
        values.push(
          species.kingdom ?? classification?.kingdom ?? "",
          species.phylum ?? classification?.phylum ?? "",
          species.class ?? classification?.class ?? "",
          species.order ?? classification?.order ?? "",
          species.family ?? classification?.family ?? "",
          species.genus ?? classification?.genus ?? "",
          species.taxonomy?.authorship ?? "",
          species.taxonomy?.name_published_in_year ?? "",
          species.taxonomy_status,
        );
        break;
      case "occurrence":
        values.push(occurrenceCountOf(species));
        break;
      case "sources": {
        const sources = species.evidence?.sources ?? [];
        const citations = sources.map((s) => citationFor(s, species.gbif_taxon_key, accessDate));
        values.push(citations.join("; "));
        break;
      }
      case "evidence":
        values.push(EVIDENCE_QUALITY_STYLES[species.evidence_quality].label);
        break;
      case "review":
        values.push(REVIEW_STATUS_STYLES[species.review_status].label);
        break;
    }
  }
  return values;
}

function toCsvValue(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\r\n");
}

async function buildExcelWorkbook(headers: string[], rows: { species: Species; values: (string | number)[] }[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Species");
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const { species, values } of rows) {
    const row = sheet.addRow(values);
    row.alignment = { vertical: "top", wrapText: true };
    const fill = ROW_FILL_BY_TAXONOMY_STATUS[species.taxonomy_status];
    if (fill) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = headers[i] === "Sources (Citations)" ? 60 : 20;
  });

  const legend = workbook.addWorksheet("Legend");
  legend.addRow(["Row Color", "Meaning"]).font = { bold: true };
  const legendRows: [string, string][] = [
    ["Red", "Authority Conflict — names from different sources disagree"],
    ["Yellow", "Synonym / Outdated name, or Unresolved — no backbone match"],
    ["Green", "Accepted — taxonomy is clean"],
  ];
  const legendFills: Record<string, string> = {
    Red: "FFFEE2E2",
    Yellow: "FFFEF3C7",
    Green: "FFDCFCE7",
  };
  for (const [color, meaning] of legendRows) {
    const row = legend.addRow([color, meaning]);
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: legendFills[color] } };
  }
  legend.columns.forEach((col, i) => {
    col.width = i === 0 ? 12 : 60;
  });

  return workbook.xlsx.writeBuffer();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds a CSV/XLSX file from the given species rows (already filtered/sorted
 * by the caller — this only picks which columns to include) and triggers a
 * browser download. Excel exports also color each row's fill by taxonomy
 * status (red/yellow/green, matching the workbench table) and add a Legend
 * sheet explaining the colors — CSV is plain text and can't carry color. */
export async function exportSpecies(
  species: Species[],
  fields: ExportField[],
  format: ExportFormat,
  fileBaseName: string,
): Promise<void> {
  const orderedFields = EXPORT_FIELDS.filter((f) => fields.includes(f));
  const headers = buildHeaders(orderedFields);
  const accessDate = new Date();
  const rows = species.map((s) => ({ species: s, values: buildRowValues(s, orderedFields, accessDate) }));

  if (format === "csv") {
    const csv = buildCsv(headers, rows.map((r) => r.values));
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${fileBaseName}.csv`);
    return;
  }

  const buffer = await buildExcelWorkbook(headers, rows);
  downloadBlob(
    new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileBaseName}.xlsx`,
  );
}
