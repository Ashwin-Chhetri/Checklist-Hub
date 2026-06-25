// Ported from app/src/modules/evidence/discovery/literature/backboneMatch.ts.
const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "gbif-backbone.sqlite");

let db = null;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

function matchCanonicalSpecies(names, taxonHint) {
  const database = getDb();
  const result = {};

  const speciesStmt = database.prepare(
    `SELECT canonical_name, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus, taxonomic_status
       FROM gbif_taxa WHERE canonical_name = ? AND taxon_rank = 'species'`,
  );
  const subspeciesStmt = database.prepare(
    `SELECT canonical_name, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus, taxonomic_status
       FROM gbif_taxa WHERE canonical_name GLOB ? AND taxon_rank = 'subspecies'`,
  );

  const hint = taxonHint?.toLowerCase();
  const matchesHint = (r) =>
    !hint || [r.kingdom, r.phylum, r.class, r.order, r.family, r.genus].some((v) => v?.toLowerCase() === hint);
  const isUsable = (r) => r.taxonomic_status === "accepted" || r.taxonomic_status === "synonym";

  for (const name of names) {
    const rows = speciesStmt.all(name);
    const usable = rows.filter((r) => isUsable(r) && matchesHint(r));
    if (usable.length > 0) {
      const row = usable[0];
      result[name] = { canonicalName: row.canonical_name, scientificName: row.scientific_name ?? row.canonical_name };
      continue;
    }

    const subspeciesRows = subspeciesStmt.all(`${name} *`);
    const usableSubspecies = subspeciesRows.filter((r) => isUsable(r) && matchesHint(r));
    if (usableSubspecies.length > 0) {
      result[name] = { canonicalName: name, scientificName: name };
    }
  }
  return result;
}

module.exports = { matchCanonicalSpecies };
