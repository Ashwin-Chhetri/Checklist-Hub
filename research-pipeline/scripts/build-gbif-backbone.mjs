// Builds a local SQLite lookup DB (app/data/gbif-backbone.sqlite) from the GBIF
// Backbone Taxonomy dump (app/public/data/backbone.zip), extracting Taxon.tsv
// for taxonomy rows and VernacularName.tsv for multi-language common names.
//
// Usage: node scripts/build-gbif-backbone.mjs [--limit=2000]

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ZIP_PATH = path.join(ROOT, "public", "data", "backbone.zip");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "gbif-backbone.sqlite");
const DB_TMP_PATH = path.join(DATA_DIR, "gbif-backbone.sqlite.tmp");

const ACCEPTED_STATUSES = new Set(["accepted", "synonym", "doubtful"]);
const ACCEPTED_RANKS = new Set(["species", "subspecies", "variety", "form"]);

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error(`Backbone zip not found at ${ZIP_PATH}`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_TMP_PATH)) fs.unlinkSync(DB_TMP_PATH);

  const db = new Database(DB_TMP_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");

  db.exec(`
    CREATE TABLE gbif_taxa (
      taxon_id                INTEGER PRIMARY KEY,
      scientific_name         TEXT,
      canonical_name          TEXT,
      scientific_name_authorship TEXT,
      taxon_rank              TEXT,
      taxonomic_status        TEXT,
      accepted_taxon_id       INTEGER,
      kingdom                 TEXT,
      phylum                  TEXT,
      class                   TEXT,
      "order"                 TEXT,
      family                  TEXT,
      genus                   TEXT,
      vernacular_name         TEXT,
      -- Provenance / hierarchy columns
      parent_taxon_id         INTEGER,
      name_according_to       TEXT,
      name_published_in       TEXT,
      name_published_in_year  INTEGER,
      generic_name            TEXT,
      specific_epithet        TEXT
    );
  `);

  // Multi-language vernacular names table — stores ALL languages, not just English.
  // vernacular_name TEXT, language TEXT (ISO 639), country_code TEXT (ISO 3166-1 alpha-2),
  // is_preferred INTEGER (0/1). PRIMARY KEY prevents duplicates on rebuild.
  db.exec(`
    CREATE TABLE gbif_vernacular_names (
      taxon_id        INTEGER NOT NULL,
      vernacular_name TEXT    NOT NULL,
      language        TEXT,
      country_code    TEXT,
      is_preferred    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (taxon_id, language, vernacular_name)
    );
    CREATE INDEX idx_vernacular_taxon ON gbif_vernacular_names(taxon_id);
    CREATE INDEX idx_vernacular_lang  ON gbif_vernacular_names(language);
  `);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO gbif_taxa
      (taxon_id, scientific_name, canonical_name, scientific_name_authorship, taxon_rank,
       taxonomic_status, accepted_taxon_id, kingdom, phylum, class, "order", family, genus,
       parent_taxon_id, name_according_to, name_published_in, name_published_in_year,
       generic_name, specific_epithet)
    VALUES
      (@taxon_id, @scientific_name, @canonical_name, @scientific_name_authorship, @taxon_rank,
       @taxonomic_status, @accepted_taxon_id, @kingdom, @phylum, @class, @order, @family, @genus,
       @parent_taxon_id, @name_according_to, @name_published_in, @name_published_in_year,
       @generic_name, @specific_epithet)
  `);

  // Preferred English name → gbif_taxa.vernacular_name (fast single-value shortcut).
  const updateVernacular = db.prepare(
    `UPDATE gbif_taxa SET vernacular_name = ? WHERE taxon_id = ? AND vernacular_name IS NULL`,
  );

  // All vernacular names → gbif_vernacular_names table.
  const insertVernacular = db.prepare(`
    INSERT OR IGNORE INTO gbif_vernacular_names
      (taxon_id, vernacular_name, language, country_code, is_preferred)
    VALUES (?, ?, ?, ?, ?)
  `);

  let columnIndex = null;
  let batch = [];
  let total = 0;
  let scanned = 0;

  const flush = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  const entry = await fs
    .createReadStream(ZIP_PATH)
    .pipe(unzipper.ParseOne(/Taxon\.tsv/));

  const rl = readline.createInterface({ input: entry, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    const fields = line.split("\t");

    if (!columnIndex) {
      columnIndex = {};
      fields.forEach((name, i) => {
        columnIndex[name] = i;
      });
      continue;
    }

    scanned += 1;

    const taxonomicStatus = (fields[columnIndex.taxonomicStatus] ?? "").toLowerCase();
    const taxonRank = (fields[columnIndex.taxonRank] ?? "").toLowerCase();

    if (!ACCEPTED_STATUSES.has(taxonomicStatus) || !ACCEPTED_RANKS.has(taxonRank)) {
      continue;
    }

    const taxonId = Number(fields[columnIndex.taxonID]);
    if (!Number.isFinite(taxonId)) continue;

    const acceptedRaw = fields[columnIndex.acceptedNameUsageID];
    const acceptedTaxonId = acceptedRaw ? Number(acceptedRaw) : null;

    const parentRaw = fields[columnIndex.parentNameUsageID];
    const parentTaxonId = parentRaw ? Number(parentRaw) : null;

    const namePublishedInYearRaw = fields[columnIndex.namePublishedInYear];
    const namePublishedInYear = namePublishedInYearRaw ? Number(namePublishedInYearRaw) : null;

    batch.push({
      taxon_id: taxonId,
      scientific_name: fields[columnIndex.scientificName] || null,
      canonical_name: fields[columnIndex.canonicalName] || null,
      scientific_name_authorship: fields[columnIndex.scientificNameAuthorship] || null,
      taxon_rank: fields[columnIndex.taxonRank] || null,
      taxonomic_status: taxonomicStatus || null,
      accepted_taxon_id: Number.isFinite(acceptedTaxonId) ? acceptedTaxonId : null,
      kingdom: fields[columnIndex.kingdom] || null,
      phylum: fields[columnIndex.phylum] || null,
      class: fields[columnIndex.class] || null,
      order: fields[columnIndex.order] || null,
      family: fields[columnIndex.family] || null,
      genus: fields[columnIndex.genus] || null,
      parent_taxon_id: Number.isFinite(parentTaxonId) ? parentTaxonId : null,
      name_according_to: fields[columnIndex.nameAccordingTo] || null,
      name_published_in: fields[columnIndex.namePublishedIn] || null,
      name_published_in_year: Number.isFinite(namePublishedInYear) ? namePublishedInYear : null,
      generic_name: fields[columnIndex.genericName] || null,
      specific_epithet: fields[columnIndex.specificEpithet] || null,
    });
    total += 1;

    if (batch.length >= 5000) {
      flush(batch);
      batch = [];
    }

    if (limit && total >= limit) break;
  }

  if (batch.length > 0) flush(batch);

  db.exec("CREATE INDEX idx_gbif_taxa_canonical ON gbif_taxa(canonical_name)");
  db.exec("CREATE INDEX idx_gbif_taxa_canonical_lower ON gbif_taxa(LOWER(canonical_name))");
  db.exec("CREATE INDEX idx_gbif_taxa_accepted ON gbif_taxa(accepted_taxon_id)");
  db.exec("CREATE INDEX idx_gbif_taxa_parent ON gbif_taxa(parent_taxon_id)");
  // Supports the "elevated subspecies epithet" fallback in backbone.server.ts:
  // many older checklists use a binomial (e.g. "Butorides atricapilla") for a
  // name GBIF now only carries as an infraspecific epithet under a different
  // species (e.g. "Butorides striata atricapilla"). That fallback filters by
  // (genus, taxon_rank) before scanning for the matching trailing epithet.
  db.exec("CREATE INDEX idx_gbif_taxa_genus_rank ON gbif_taxa(genus, taxon_rank)");

  console.log(`Scanned ${scanned} Taxon.tsv rows, wrote ${total} taxa to ${DB_TMP_PATH}`);

  // Second pass: read VernacularName.tsv — store ALL languages in gbif_vernacular_names,
  // and populate gbif_taxa.vernacular_name with the preferred English name for fast access.
  console.log("Reading VernacularName.tsv...");
  let vernacularEntry;
  try {
    vernacularEntry = await fs
      .createReadStream(ZIP_PATH)
      .pipe(unzipper.ParseOne(/VernacularName\.tsv/));
  } catch {
    console.warn("VernacularName.tsv not found in zip — skipping vernacular names.");
  }

  if (vernacularEntry) {
    let vernacularColumnIndex = null;
    let vernacularTotal = 0;
    let preferredEnglishTotal = 0;

    const vernacularBatch = [];
    const preferredEnglishBatch = [];

    const flushVernacular = db.transaction((rows) => {
      for (const [taxonId, name, lang, country, isPref] of rows) {
        insertVernacular.run(taxonId, name, lang, country, isPref);
      }
    });
    const flushPreferredEnglish = db.transaction((rows) => {
      for (const [name, taxonId] of rows) updateVernacular.run(name, taxonId);
    });

    const rl2 = readline.createInterface({ input: vernacularEntry, crlfDelay: Infinity });
    for await (const line of rl2) {
      if (!line) continue;
      const fields = line.split("\t");
      if (!vernacularColumnIndex) {
        vernacularColumnIndex = {};
        fields.forEach((name, i) => { vernacularColumnIndex[name] = i; });
        continue;
      }

      const taxonId = Number(fields[vernacularColumnIndex.taxonID]);
      if (!Number.isFinite(taxonId)) continue;

      const vernacularName = fields[vernacularColumnIndex.vernacularName]?.trim();
      if (!vernacularName) continue;

      const lang = (fields[vernacularColumnIndex.language] ?? "").toLowerCase().trim() || null;
      // VernacularName.tsv uses "countryCode" column (may be blank).
      const countryCode = (fields[vernacularColumnIndex.countryCode] ?? "").trim() || null;
      const isPreferred = (fields[vernacularColumnIndex.isPreferredName] ?? "").toLowerCase() === "true" ? 1 : 0;

      vernacularBatch.push([taxonId, vernacularName, lang, countryCode, isPreferred]);
      vernacularTotal += 1;

      // Also queue preferred English rows for the fast-access column.
      if ((lang === "eng" || lang === "en") && isPreferred) {
        preferredEnglishBatch.push([vernacularName, taxonId]);
        preferredEnglishTotal += 1;
      }

      if (vernacularBatch.length >= 5000) {
        flushVernacular(vernacularBatch);
        vernacularBatch.length = 0;
      }
    }

    if (vernacularBatch.length > 0) flushVernacular(vernacularBatch);

    // Populate the fast-access column for preferred English names.
    // For taxa with no preferred English row, fall back to any English row.
    if (preferredEnglishBatch.length > 0) flushPreferredEnglish(preferredEnglishBatch);

    // Fallback: any English row for taxa still missing vernacular_name.
    const fillFallback = db.transaction(() => {
      const fallbackRows = db.prepare(`
        SELECT taxon_id, vernacular_name FROM gbif_vernacular_names
        WHERE (language = 'eng' OR language = 'en')
          AND taxon_id IN (SELECT taxon_id FROM gbif_taxa WHERE vernacular_name IS NULL)
        GROUP BY taxon_id
      `).all();
      for (const row of fallbackRows) {
        updateVernacular.run(row.vernacular_name, row.taxon_id);
      }
    });
    fillFallback();

    console.log(
      `Wrote ${vernacularTotal} vernacular name entries (${preferredEnglishTotal} preferred English).`,
    );
  }

  db.close();

  // Atomic swap: replace the live file only after the new one is complete.
  // On Windows the dev server holds the file open (read-only), which blocks
  // unlink. Stop the server before running this script if you hit EBUSY.
  if (fs.existsSync(DB_PATH)) {
    try {
      fs.unlinkSync(DB_PATH);
    } catch (err) {
      if (err.code === "EBUSY" || err.code === "EPERM") {
        fs.unlinkSync(DB_TMP_PATH);
        console.error(
          "\nError: the existing backbone file is locked by another process (likely the dev server).\n" +
          "Stop the dev server first (Ctrl+C), then re-run this script.\n",
        );
        process.exit(1);
      }
      throw err;
    }
  }
  fs.renameSync(DB_TMP_PATH, DB_PATH);

  console.log(`Done. Backbone written to ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
