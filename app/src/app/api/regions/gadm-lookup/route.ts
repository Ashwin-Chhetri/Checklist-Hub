import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";

// Local-disk GADM name->GID lookup (built via `npm run build:gadm`). Used to
// populate `region_gadm_id` so GBIF occurrence queries can be scoped to the
// selected region via GBIF's `gadmGid` parameter (see
// src/modules/evidence/services/gbifEvidence.ts).
//
// Per AGENTS.md, heavy reference tables live on the server filesystem as
// SQLite, queried readonly here — not Supabase.
const DB_PATH = path.join(process.cwd(), "data", "gadm.sqlite");

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

interface GadmRow {
  gid: string;
  level: number;
  name: string;
}

export interface GadmLookupResult {
  gid: string | null;
  level: number | null;
  matchedName: string | null;
}

export async function POST(request: Request) {
  const { country, state, district } = (await request.json()) as {
    country?: string;
    state?: string;
    district?: string;
  };

  const database = getDb();
  if (!database || !country) {
    return NextResponse.json<GadmLookupResult>({ gid: null, level: null, matchedName: null });
  }

  if (district && state) {
    const exact = database
      .prepare(
        `SELECT gid, level, name FROM gadm_regions
         WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) = lower(?)`,
      )
      .get(country, state, district) as GadmRow | undefined;
    if (exact) {
      return NextResponse.json<GadmLookupResult>({ gid: exact.gid, level: exact.level, matchedName: exact.name });
    }

    // GADM and Nominatim sometimes use different transliterations of the same
    // district (e.g. "Darjeeling" vs "Darjiling") — fall back to a prefix match.
    const prefix = district.slice(0, 4);
    if (prefix.length >= 4) {
      const fuzzy = database
        .prepare(
          `SELECT gid, level, name FROM gadm_regions
           WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) LIKE lower(?) || '%'`,
        )
        .get(country, state, prefix) as GadmRow | undefined;
      if (fuzzy) {
        return NextResponse.json<GadmLookupResult>({ gid: fuzzy.gid, level: fuzzy.level, matchedName: fuzzy.name });
      }
    }
  }

  if (state) {
    const row = database
      .prepare(
        `SELECT gid, level, name FROM gadm_regions
         WHERE level = 1 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?)`,
      )
      .get(country, state) as GadmRow | undefined;
    if (row) {
      return NextResponse.json<GadmLookupResult>({ gid: row.gid, level: row.level, matchedName: row.name });
    }
  }

  const row = database
    .prepare(`SELECT gid, level, name FROM gadm_regions WHERE level = 0 AND lower(country_name) = lower(?)`)
    .get(country) as GadmRow | undefined;
  if (row) {
    return NextResponse.json<GadmLookupResult>({ gid: row.gid, level: row.level, matchedName: row.name });
  }

  return NextResponse.json<GadmLookupResult>({ gid: null, level: null, matchedName: null });
}
