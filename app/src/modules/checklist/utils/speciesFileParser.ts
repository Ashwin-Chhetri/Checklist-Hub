import * as XLSX from "xlsx";
import type { CreateChecklistSpeciesInput, ImportIssueType } from "@/types/checklist.types";

/**
 * A row destined for checklist creation. CSV rows only populate the base
 * fields; discovery-sourced rows additionally carry the taxonomy/evidence
 * fields from `CreateChecklistSpeciesInput`.
 */
export type ParsedSpeciesRow = CreateChecklistSpeciesInput;

/** A parser-detected issue, before it is persisted as a real ImportIssue (which needs an import_id). */
export interface ParsedImportIssue {
  /** 1-based row number as it appears in the source file (header = row 1). */
  row: number;
  issue_type: ImportIssueType;
  description: string;
}

export interface ParseResult {
  rows: ParsedSpeciesRow[];
  issues: ParsedImportIssue[];
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

const MIN_PLAUSIBLE_YEAR = 1700;

/** Try a handful of common date formats; returns an ISO date string or null. */
function normalizeEventDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pure year, e.g. "1998"
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    if (year >= MIN_PLAUSIBLE_YEAR && year <= new Date().getFullYear() + 1) {
      return `${trimmed}-01-01`;
    }
    return null;
  }

  // dd/mm/yyyy or mm/dd/yyyy — ambiguous, but both produce a valid calendar date often.
  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    const day = Number(a) > 12 ? a : b;
    const month = Number(a) > 12 ? b : a;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
    return null;
  }

  // Fall back to native parsing (handles ISO, "12 Jan 2020", etc.)
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  const year = new Date(parsed).getFullYear();
  if (year < MIN_PLAUSIBLE_YEAR || year > new Date().getFullYear() + 1) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Builds species rows from a list of plain records (one per data row),
 * matching columns by substring regardless of casing/spacing/underscores —
 * "Scientific Name", "scientificName", and "scientific_name" all resolve to
 * the same field. Shared by every supported file format (CSV/TSV, JSON,
 * Excel) so they all get identical validation and duplicate detection.
 */
function buildRowsFromRecords(records: Record<string, string>[], rowOffset: number): ParseResult {
  const issues: ParsedImportIssue[] = [];

  if (records.length === 0) {
    issues.push({ row: 1, issue_type: "malformed_row", description: "File contains no data rows." });
    return { rows: [], issues };
  }

  const keys = Object.keys(records[0]);
  const nameKey = keys.find((k) => k.toLowerCase().includes("scientific"));
  const commonKey = keys.find((k) => k.toLowerCase().includes("common"));
  const countKey = keys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes("occurrence") || lower.includes("count");
  });
  const dateKey = keys.find((k) => k.toLowerCase().includes("date"));

  if (!nameKey) {
    issues.push({
      row: 1,
      issue_type: "malformed_row",
      description: 'No "Scientific Name" column found in the header row.',
    });
    return { rows: [], issues };
  }

  const rows: ParsedSpeciesRow[] = [];
  const seenNames = new Map<string, number>();

  records.forEach((record, i) => {
    const rowNum = i + rowOffset;
    const scientificName = record[nameKey]?.trim() ?? "";
    if (!scientificName) {
      issues.push({
        row: rowNum,
        issue_type: "missing_name",
        description: "Row has no scientific name and was skipped.",
      });
      return;
    }

    const dedupeKey = scientificName.toLowerCase();
    if (seenNames.has(dedupeKey)) {
      issues.push({
        row: rowNum,
        issue_type: "duplicate_row",
        description: `Duplicate of row ${seenNames.get(dedupeKey)} ("${scientificName}").`,
      });
    } else {
      seenNames.set(dedupeKey, rowNum);
    }

    let occurrenceCount: number | undefined;
    if (countKey) {
      const raw = record[countKey]?.trim();
      if (raw) {
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
          issues.push({
            row: rowNum,
            issue_type: "invalid_count",
            description: `Occurrence count "${raw}" is not a non-negative integer and was ignored.`,
          });
        } else {
          occurrenceCount = num;
        }
      }
    }

    let eventDate: string | undefined;
    if (dateKey) {
      const raw = record[dateKey]?.trim();
      if (raw) {
        const normalized = normalizeEventDate(raw);
        if (!normalized) {
          issues.push({
            row: rowNum,
            issue_type: "invalid_date",
            description: `Event date "${raw}" could not be parsed and was ignored.`,
          });
        } else {
          eventDate = normalized;
        }
      }
    }

    rows.push({
      scientific_name: scientificName,
      common_name: commonKey ? record[commonKey]?.trim() || undefined : undefined,
      occurrence_count: occurrenceCount,
      event_date: eventDate,
    });
  });

  return { rows, issues };
}

/** Parses CSV/TSV text into the same {header, records} shape every format funnels through. */
function parseDelimitedText(text: string, delimiter: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return {
      rows: [],
      issues: [
        {
          row: 1,
          issue_type: "malformed_row",
          description: "File must contain a header row and at least one data row.",
        },
      ],
    };
  }

  const header = parseDelimitedLine(lines[0], delimiter).map((h) => h.trim());
  const malformedRowIssues: ParsedImportIssue[] = [];

  const records = lines.slice(1).map((line, i) => {
    const cols = parseDelimitedLine(line, delimiter);
    if (cols.length !== header.length) {
      malformedRowIssues.push({
        row: i + 2,
        issue_type: "malformed_row",
        description: `Expected ${header.length} column(s), found ${cols.length}.`,
      });
    }
    const record: Record<string, string> = {};
    header.forEach((h, j) => {
      record[h] = cols[j] ?? "";
    });
    return record;
  });

  const result = buildRowsFromRecords(records, 2);
  return { rows: result.rows, issues: [...malformedRowIssues, ...result.issues] };
}

/** Coerces every cell value (numbers, booleans, dates from Excel) to a trimmable string. */
function stringifyRecord(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["csv", "tsv", "txt", "json", "xlsx", "xls"];

/**
 * Fault-tolerant species list parser supporting CSV, TSV, JSON (array of
 * objects), and Excel (.xlsx/.xls — first sheet). Column matching is
 * flexible for "Scientific Name"/"scientificName"/"scientific_name" (and the
 * same for Common Name, Occurrence Count, Event Date) — malformed cells are
 * coerced or dropped with a recorded issue rather than failing the whole
 * import, so the caller can surface problems inline next to the upload.
 */
export async function parseSpeciesFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (file.size > MAX_FILE_SIZE) {
    return {
      rows: [],
      issues: [
        {
          row: 1,
          issue_type: "malformed_row",
          description: `File exceeds the ${MAX_FILE_SIZE / (1024 * 1024)}MB size limit.`,
        },
      ],
    };
  }

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      rows: [],
      issues: [
        {
          row: 1,
          issue_type: "malformed_row",
          description: `Unsupported file type ".${ext}". Supported formats: CSV, TSV, JSON, XLSX, XLS.`,
        },
      ],
    };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    return buildRowsFromRecords(records.map(stringifyRecord), 2);
  }

  const text = await file.text();

  if (ext === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        rows: [],
        issues: [{ row: 1, issue_type: "malformed_row", description: "File is not valid JSON." }],
      };
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "object") {
      return {
        rows: [],
        issues: [
          {
            row: 1,
            issue_type: "malformed_row",
            description: "JSON file must contain a non-empty array of species records.",
          },
        ],
      };
    }
    return buildRowsFromRecords((parsed as Record<string, unknown>[]).map(stringifyRecord), 2);
  }

  return parseDelimitedText(text, ext === "tsv" ? "\t" : ",");
}

export interface ParsedFileResult extends ParseResult {
  fileName: string;
}

/**
 * Parses each file independently (any mix of supported formats), keeping
 * results separate per file so the caller can display/remove them one at a
 * time rather than only as a single combined blob.
 */
export async function parseSpeciesFilesIndividually(files: File[]): Promise<ParsedFileResult[]> {
  const perFile = await Promise.all(files.map((file) => parseSpeciesFile(file)));
  return perFile.map((result, i) => ({ ...result, fileName: files[i].name }));
}

/**
 * Merges already-parsed per-file results into one combined {rows, issues},
 * prefixing each file's issues with its name so problems remain traceable to
 * their source, and flagging species names that repeat across files (not
 * just within one) as duplicates. Re-run this whenever the set of files
 * changes (e.g. one is removed) to recompute the combined import.
 */
export function mergeParsedFiles(files: ParsedFileResult[]): ParseResult {
  const rows: ParsedSpeciesRow[] = [];
  const issues: ParsedImportIssue[] = [];
  const seenNames = new Map<string, string>();

  for (const file of files) {
    for (const issue of file.issues) {
      issues.push({ ...issue, description: `[${file.fileName}] ${issue.description}` });
    }
    for (const row of file.rows) {
      const dedupeKey = row.scientific_name.trim().toLowerCase();
      const firstSeenIn = seenNames.get(dedupeKey);
      if (firstSeenIn) {
        issues.push({
          row: 0,
          issue_type: "duplicate_row",
          description: `[${file.fileName}] "${row.scientific_name}" already imported from ${firstSeenIn} and was skipped.`,
        });
        continue;
      }
      seenNames.set(dedupeKey, file.fileName);
      rows.push(row);
    }
  }

  return { rows, issues };
}
