// One-time data repair for two real bugs in buildSpeciesPayload.server.ts
// (now fixed in code):
//   1. Every place that gated "only set classification if the row doesn't
//      already have one" checked `!s.classification` — but evidence
//      discovery pre-attaches an all-null placeholder object before backbone
//      enrichment runs, and that placeholder is a truthy object, so the gate
//      silently skipped the real backbone-derived hierarchy for almost every
//      synonym/conflict/accepted row.
//   2. Synonym entries stored the ACCEPTED taxon's hierarchy/year on the
//      synonym's own record instead of the synonym's OWN hierarchy/year (see
//      backbone.server.ts's `ownClassification`/`ownNamePublishedInYear`).
//
// This walks every species row and, for the row's own top-level taxonomy
// plus every taxonomy.synonyms[] / taxonomy.authority_conflicts[] entry still
// missing data, tries EVERY identifying string available for that specific
// name — its own taxon_id, its own name, and (as a last resort) every common
// name known for the row — stopping at the first candidate that resolves
// real hierarchy data (mirrors `lookupBackboneExhaustive` in
// backbone.server.ts, reimplemented here in plain SQL since this script runs
// outside the Next.js/TS build). Conflict entries' own `authority` field is a
// source/provenance label (e.g. "GBIF Backbone", "ebird") and is never
// touched. Synonym entries' `authority` field IS a real taxonomic authorship
// for event_type "synonym" (overwritten when a better value is found) but a
// source label for event_type "source_synonym" (left alone).
//
// Usage: node scripts/backfill-taxonomy-hierarchy.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// This script never opens a realtime channel, but supabase-js's constructor
// initializes one unconditionally — Node 20 has no global WebSocket, so it
// needs an explicit transport.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { realtime: { transport: ws } });

const DB_PATH = path.join(ROOT, "data", "gbif-backbone.sqlite");
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const cols = db.prepare("PRAGMA table_info(gbif_taxa)").all().map((c) => c.name);
const authCol = cols.includes("scientific_name_authorship") ? "scientific_name_authorship" : "NULL as scientific_name_authorship";
const yearCol = cols.includes("name_published_in_year") ? "name_published_in_year" : "NULL as name_published_in_year";

const SELECT_FIELDS = `taxon_id, canonical_name, ${authCol} as authorship, ${yearCol} as year, kingdom, phylum, class, "order", family, genus`;
const byKeyStmt = db.prepare(`SELECT ${SELECT_FIELDS} FROM gbif_taxa WHERE taxon_id = ?`);
const byNameStmt = db.prepare(`SELECT ${SELECT_FIELDS} FROM gbif_taxa WHERE LOWER(canonical_name) = LOWER(?) LIMIT 1`);

const hasVernacularTable = (() => {
  try {
    db.prepare("SELECT 1 FROM gbif_vernacular_names LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
})();

function toResult(row) {
  if (!row) return null;
  return {
    taxon_id: row.taxon_id,
    authorship: row.authorship ?? null,
    year: row.year ?? null,
    classification: {
      kingdom: row.kingdom ?? null,
      phylum: row.phylum ?? null,
      class: row.class ?? null,
      order: row.order ?? null,
      family: row.family ?? null,
      genus: row.genus ?? null,
      species: row.canonical_name ?? null,
    },
  };
}

function lookup(taxonId, name) {
  const row = taxonId ? byKeyStmt.get(taxonId) : name ? byNameStmt.get(name) : undefined;
  return toResult(row);
}

/** Simplified version of lookupByVernacularName (backbone.server.ts): matches
 * on substring tokens of the common name, English-only, requiring every
 * candidate row to converge on the same accepted taxon. Good enough for a
 * one-time backfill — the full qualifier-stripping logic isn't needed here
 * since this is a best-effort last resort, not the primary resolution path. */
function lookupByCommonName(commonName) {
  if (!hasVernacularTable || !commonName) return null;
  const normalized = commonName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = normalized.split(" ").filter((w) => w.length >= 3);
  if (tokens.length === 0) return null;

  const conditions = tokens.map(() => "LOWER(gvn.vernacular_name) LIKE ?").join(" AND ");
  const params = tokens.map((t) => `%${t}%`);
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT DISTINCT gvn.taxon_id, gt.accepted_taxon_id
         FROM gbif_vernacular_names gvn
         JOIN gbif_taxa gt ON gt.taxon_id = gvn.taxon_id
         WHERE gvn.language IN ('eng', 'en') AND ${conditions}`,
      )
      .all(...params);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const acceptedIds = new Set(rows.map((r) => r.accepted_taxon_id ?? r.taxon_id));
  if (acceptedIds.size !== 1) return null; // ambiguous — leave for manual review

  return lookup([...acceptedIds][0]);
}

/** Tries taxon_id, then own name, then every common name candidate, in that
 * order, stopping at the first result that carries real hierarchy data. */
function lookupExhaustive({ taxonId, names = [], commonNames = [] }) {
  let best = null;
  const consider = (found) => {
    if (!found) return false;
    if (!best) best = found;
    return !isEmptyClassification(found.classification);
  };

  if (taxonId && consider(lookup(taxonId))) return best;
  for (const name of names) {
    if (!name?.trim()) continue;
    if (consider(lookup(undefined, name.trim()))) return best;
  }
  for (const commonName of commonNames) {
    if (!commonName?.trim()) continue;
    if (consider(lookupByCommonName(commonName.trim()))) return best;
  }
  return best;
}

function isEmptyClassification(c) {
  if (!c) return true;
  return !Object.values(c).some(Boolean);
}

let changedAnything = false;

/** Re-derives a single entry's (synonym OR conflict) own hierarchy/authorship/year
 * by trying its own name, then — if that alone doesn't resolve hierarchy data
 * — every common name known for the row (a species can have several, e.g.
 * "Medium Egret" vs "Intermediate Egret" for the same taxon, and the exact
 * historical/synonym spelling sometimes isn't on the backbone even though the
 * taxon itself is, under its current vernacular name). Never trusts a
 * previously-stored taxon_id, since old data sometimes stored the ACCEPTED
 * taxon's id instead of the entry's own. `authorityIsLabel` = true means
 * never touch `authority` (used for authority_conflicts and source_synonym
 * entries, where it's a provenance label, not a taxonomic authorship). */
function enrichEntry(entry, nameField, authorityIsLabel, commonNames) {
  const found = lookupExhaustive({ names: [entry[nameField]], commonNames });
  if (!found) return { entry, changed: false };

  const next = { ...entry };
  let changed = false;

  if (isEmptyClassification(entry.classification) && !isEmptyClassification(found.classification)) {
    next.classification = found.classification;
    changed = true;
  }
  if (!next.taxon_id && found.taxon_id) {
    next.taxon_id = found.taxon_id;
    changed = true;
  }
  if (!next.year && found.year) {
    next.year = found.year;
    changed = true;
  }
  if (!authorityIsLabel && !next.authority && found.authorship) {
    next.authority = found.authorship;
    changed = true;
  }
  if (authorityIsLabel && !next.authorship && found.authorship) {
    next.authorship = found.authorship;
    changed = true;
  }

  return { entry: next, changed };
}

async function run() {
  console.log(DRY_RUN ? "Dry run — no writes will be made.\n" : "Live run — will update Supabase.\n");

  let from = 0;
  const pageSize = 500;
  let totalScanned = 0;
  let totalUpdated = 0;

  while (true) {
    // Explicit order avoids the pagination drift that comes from offset-based
    // paging combined with concurrent UPDATEs to the same table.
    const { data, error } = await supabase
      .from("species")
      .select("id, gbif_taxon_key, common_name, identity, taxonomy")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Supabase query failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      totalScanned += 1;
      const taxonomy = row.taxonomy ?? {};
      let rowChanged = false;
      const next = { ...taxonomy };

      // Every common name known for this row — a species can have several
      // (different sources/eras use different vernacular names for the same
      // taxon) — tried as a last resort when name-based lookups don't resolve
      // hierarchy data on their own.
      const commonNames = [row.common_name, row.identity?.imported_common_name];

      // Top-level classification/authorship/year — the row's own resolved
      // CURRENT/accepted name. Tries gbif_taxon_key first (always the accepted
      // taxon), then any recorded name, then common names. A row with open
      // conflicts and no confirmed identity has that identity DELIBERATELY left
      // unresolved pending user review — never use a conflict's suggested_name
      // (a DIFFERENT row's identity) or the row's common name (the same weak
      // convergence that flagged the conflict) to resolve this row's own
      // classification, or both options would end up showing the same data.
      const hasOpenConflicts = Array.isArray(taxonomy.authority_conflicts) && taxonomy.authority_conflicts.length > 0;
      if ((isEmptyClassification(taxonomy.classification) || !taxonomy.authorship) && !(hasOpenConflicts && !row.gbif_taxon_key)) {
        const names = [
          taxonomy.current_name,
          taxonomy.accepted_name,
          ...(Array.isArray(taxonomy.synonyms) ? taxonomy.synonyms.map((s) => s.name) : []),
        ];
        const found = lookupExhaustive({ taxonId: row.gbif_taxon_key ?? undefined, names, commonNames });
        if (found) {
          if (isEmptyClassification(taxonomy.classification) && !isEmptyClassification(found.classification)) {
            next.classification = found.classification;
            rowChanged = true;
          }
          if (!taxonomy.authorship && found.authorship) {
            next.authorship = found.authorship;
            rowChanged = true;
          }
          if (!taxonomy.name_published_in_year && found.year) {
            next.name_published_in_year = found.year;
            rowChanged = true;
          }
        }
      }

      const synonyms = Array.isArray(taxonomy.synonyms) ? taxonomy.synonyms : [];
      const nextSynonyms = synonyms.map((s) => {
        const { entry, changed } = enrichEntry(s, "name", s.event_type === "source_synonym", commonNames);
        if (changed) rowChanged = true;
        return entry;
      });
      if (synonyms.length > 0) next.synonyms = nextSynonyms;

      const conflicts = Array.isArray(taxonomy.authority_conflicts) ? taxonomy.authority_conflicts : [];
      const nextConflicts = conflicts.map((c) => {
        // No commonNames fallback for conflicts: a conflict's suggested_name is a
        // candidate DIFFERENT from the row's own, specifically because direct
        // evidence didn't fully agree — falling back to the row's common name
        // would resolve via the same weak convergence that flagged the conflict,
        // risking giving this option whichever taxon a different option already owns.
        const { entry, changed } = enrichEntry(c, "suggested_name", true, undefined);
        if (changed) rowChanged = true;
        return entry;
      });
      if (conflicts.length > 0) next.authority_conflicts = nextConflicts;

      if (!rowChanged) continue;

      totalUpdated += 1;
      changedAnything = true;
      console.log(`Species ${row.id}: enriched taxonomy hierarchy/authorship/year.`);

      if (!DRY_RUN) {
        const { error: updateError } = await supabase.from("species").update({ taxonomy: next }).eq("id", row.id);
        if (updateError) {
          console.error(`  Failed to update species ${row.id}:`, updateError.message);
        }
      }
    }

    from += pageSize;
  }

  console.log(`\nDone. Scanned ${totalScanned} species rows, ${totalUpdated} updated.`);
  if (DRY_RUN) console.log("(Dry run — nothing was written. Re-run without --dry-run to apply.)");
  if (!changedAnything) console.log("Nothing left to fix — data is fully enriched.");
}

run();
