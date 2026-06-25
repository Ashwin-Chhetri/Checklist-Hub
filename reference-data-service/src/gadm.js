// Ported from app/src/app/api/regions/gadm-lookup/route.ts and
// app/src/lib/regions/ensureRegionBoundaryCached.server.ts's readGadmRow.
const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "gadm.sqlite");

let db = null;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

function lookup({ country, state, district }) {
  const database = getDb();
  if (!country) return { gid: null, level: null, matchedName: null };

  if (district && state) {
    const exact = database
      .prepare(
        `SELECT gid, level, name FROM gadm_regions
         WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) = lower(?)`,
      )
      .get(country, state, district);
    if (exact) return { gid: exact.gid, level: exact.level, matchedName: exact.name };

    const prefix = district.slice(0, 4);
    if (prefix.length >= 4) {
      const fuzzy = database
        .prepare(
          `SELECT gid, level, name FROM gadm_regions
           WHERE level = 2 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?) AND lower(district_name) LIKE lower(?) || '%'`,
        )
        .get(country, state, prefix);
      if (fuzzy) return { gid: fuzzy.gid, level: fuzzy.level, matchedName: fuzzy.name };
    }
  }

  if (state) {
    const row = database
      .prepare(
        `SELECT gid, level, name FROM gadm_regions
         WHERE level = 1 AND lower(country_name) = lower(?) AND lower(state_name) = lower(?)`,
      )
      .get(country, state);
    if (row) return { gid: row.gid, level: row.level, matchedName: row.name };
  }

  const row = database
    .prepare(`SELECT gid, level, name FROM gadm_regions WHERE level = 0 AND lower(country_name) = lower(?)`)
    .get(country);
  if (row) return { gid: row.gid, level: row.level, matchedName: row.name };

  return { gid: null, level: null, matchedName: null };
}

function readGadmRow(gid) {
  const database = getDb();
  const row = database.prepare(`SELECT boundary_geojson, name FROM gadm_regions WHERE gid = ?`).get(gid);

  if (!row?.boundary_geojson) {
    return { geometry: null, name: row?.name ?? null };
  }

  try {
    return { geometry: JSON.parse(row.boundary_geojson), name: row.name };
  } catch {
    return { geometry: null, name: row.name };
  }
}

module.exports = { lookup, readGadmRow };
