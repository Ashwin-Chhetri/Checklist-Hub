import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { getVernacularNames } from "@/lib/taxonomy/backbone.server";

// Local-disk GBIF backbone mirror (built via `npm run build:backbone`). This
// is a "large reference table" per the heavy-data-tables architecture in
// AGENTS.md — it lives on the server filesystem, not in Supabase.
const DB_PATH = path.join(process.cwd(), "data", "gbif-backbone.sqlite");

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    return db;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    speciesKeys?: number[];
    includeVernacularNames?: boolean;
  };

  const { speciesKeys, includeVernacularNames = false } = body;

  if (!Array.isArray(speciesKeys) || speciesKeys.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  const database = getDb();
  if (!database) {
    return NextResponse.json({ rows: [] });
  }

  const cols = (database.prepare("PRAGMA table_info(gbif_taxa)").all() as Array<{ name: string }>)
    .map((r) => r.name);

  const optionalCols = ["name_according_to", "name_published_in", "name_published_in_year", "parent_taxon_id"]
    .filter((c) => cols.includes(c));

  const selectCols = [
    "taxon_id", "scientific_name", "canonical_name", "family", "vernacular_name",
    ...optionalCols,
  ].join(", ");

  const placeholders = speciesKeys.map(() => "?").join(",");
  const rows = database
    .prepare(`SELECT ${selectCols} FROM gbif_taxa WHERE taxon_id IN (${placeholders})`)
    .all(...speciesKeys) as Array<Record<string, unknown>>;

  // Optionally attach all vernacular names (multi-language) for each taxon.
  // This adds one SQLite lookup per taxon, so only do it when requested.
  if (includeVernacularNames) {
    for (const row of rows) {
      const taxonId = row.taxon_id as number;
      try {
        row.vernacular_names = getVernacularNames(taxonId);
      } catch {
        row.vernacular_names = [];
      }
    }
  }

  return NextResponse.json({ rows });
}
