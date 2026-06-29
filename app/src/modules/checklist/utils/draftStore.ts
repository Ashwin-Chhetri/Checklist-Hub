import { openDB, type IDBPDatabase } from "idb";
import type { ParsedImportIssue, ParsedSpeciesRow } from "./speciesFileParser";
import type { CollaboratorInviteInput, TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";

const DB_NAME = "checklist-wizard-db";
const DB_VERSION = 1;
const DRAFT_ID = "current";

/**
 * Per-species draft row. Extends the base species shape with the richer
 * Workbench-facing data (evidence sources, taxonomy conflicts/synonyms,
 * publications, etc.) gathered during Steps 2-3, so Step 5 can push it
 * straight to the normalized server-side tables.
 */
export type DraftSpeciesRow = ParsedSpeciesRow;

export interface DraftMeta {
  step: number;
  title: string;
  taxonomicScope: TaxonomicScope;
  deepestTaxonKey: number | null;
  region: RegionValue;
  csvFileName: string | null;
  collaboratorInvites: CollaboratorInviteInput[];
  discoveryTotals: { totalSpecies: number; totalOccurrences: number } | null;
  /** discoverySelection Map, serialized as entries since Maps aren't JSON-native. */
  discoverySelection: Array<[string, DraftSpeciesRow]>;
  /** The Deep Search dialog's in-flight/completed run id, so a reload reattaches to the same detached server-side run instead of losing track of it. Absent on older drafts saved before this field existed. */
  deepSearchRunId?: string | null;
}

interface DraftSchema {
  draftMeta: {
    key: string;
    value: DraftMeta & { id: string; updatedAt: string };
  };
  draftSpecies: {
    key: string;
    value: DraftSpeciesRow & { key: string };
  };
  draftCsvRows: {
    key: string;
    value: DraftSpeciesRow & { key: string };
  };
  draftImportIssues: {
    key: number;
    value: ParsedImportIssue;
  };
}

let dbPromise: Promise<IDBPDatabase<DraftSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<DraftSchema>> {
  if (typeof window === "undefined") {
    throw new Error("draftStore can only be used in the browser.");
  }
  if (!dbPromise) {
    dbPromise = openDB<DraftSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("draftMeta")) {
          db.createObjectStore("draftMeta", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("draftSpecies")) {
          db.createObjectStore("draftSpecies", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("draftCsvRows")) {
          db.createObjectStore("draftCsvRows", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("draftImportIssues")) {
          db.createObjectStore("draftImportIssues", { keyPath: "id", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

function rowKey(row: DraftSpeciesRow): string {
  return row.scientific_name.trim().toLowerCase();
}

export async function loadDraft(): Promise<{
  meta: DraftMeta | null;
  species: DraftSpeciesRow[];
  csvRows: DraftSpeciesRow[];
  importIssues: ParsedImportIssue[];
}> {
  const db = await getDb();
  const [metaRow, species, csvRows, importIssues] = await Promise.all([
    db.get("draftMeta", DRAFT_ID),
    db.getAll("draftSpecies"),
    db.getAll("draftCsvRows"),
    db.getAll("draftImportIssues"),
  ]);

  let meta: DraftMeta | null = null;
  if (metaRow) {
    const { id, updatedAt, ...rest } = metaRow;
    void id;
    void updatedAt;
    meta = rest;
  }

  return {
    meta,
    species: species.map(({ key, ...row }) => {
      void key;
      return row;
    }),
    csvRows: csvRows.map(({ key, ...row }) => {
      void key;
      return row;
    }),
    importIssues,
  };
}

export async function saveDraftMeta(meta: DraftMeta): Promise<void> {
  const db = await getDb();
  await db.put("draftMeta", { ...meta, id: DRAFT_ID, updatedAt: new Date().toISOString() });
}

/** Bulk-replaces the species draft rows. */
export async function saveDraftSpecies(rows: DraftSpeciesRow[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("draftSpecies", "readwrite");
  await tx.store.clear();
  for (const row of rows) {
    await tx.store.put({ ...row, key: rowKey(row) });
  }
  await tx.done;
}

/** Bulk-replaces the raw CSV rows (pre-merge). */
export async function saveDraftCsvRows(rows: DraftSpeciesRow[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("draftCsvRows", "readwrite");
  await tx.store.clear();
  for (const row of rows) {
    await tx.store.put({ ...row, key: rowKey(row) });
  }
  await tx.done;
}

export async function saveDraftImportIssues(issues: ParsedImportIssue[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("draftImportIssues", "readwrite");
  await tx.store.clear();
  for (const issue of issues) {
    await tx.store.put(issue);
  }
  await tx.done;
}

export async function clearDraft(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["draftMeta", "draftSpecies", "draftCsvRows", "draftImportIssues"], "readwrite");
  await Promise.all([
    tx.objectStore("draftMeta").clear(),
    tx.objectStore("draftSpecies").clear(),
    tx.objectStore("draftCsvRows").clear(),
    tx.objectStore("draftImportIssues").clear(),
  ]);
  await tx.done;
}
