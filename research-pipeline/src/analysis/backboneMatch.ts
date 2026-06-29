import path from "node:path";
import Database from "better-sqlite3";
import { paths } from "../config.js";

// Local GBIF backbone mirror — built via `npm run build:gbif-backbone` from
// public/data/backbone.zip (same source/script as the main app's
// scripts/build-gbif-backbone.mjs, ported here so this standalone project
// doesn't depend on app/ at runtime). Validates LLM-extracted species names
// against real taxonomy rather than trusting free-text extraction alone —
// this is the GBIF-backbone cross-check requested on top of speciesExtraction.ts.
const DB_PATH = path.join(paths.data, "gbif-backbone.sqlite");

let db: Database.Database | null | undefined;

function getDb(): Database.Database | null {
  if (db !== undefined) return db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    db = null;
  }
  return db;
}

interface TaxonRow {
  taxon_id: number;
  canonical_name: string;
  scientific_name: string | null;
  taxon_rank: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  taxonomic_status: string | null;
  vernacular_name: string | null;
  accepted_taxon_id: number | null;
}

export interface BackboneMatch {
  canonicalName: string;
  scientificName: string;
  taxonRank: string | null;
  taxonomicStatus: string | null;
  vernacularName: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
  };
  /** Resolved accepted-name when this row's own taxonomicStatus is "synonym" — null otherwise, and null if the accepted row couldn't be found. */
  acceptedScientificName: string | null;
}

export function isBackboneAvailable(): boolean {
  return getDb() !== null;
}

const SELECT_COLUMNS = `taxon_id, canonical_name, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus, taxonomic_status, vernacular_name, accepted_taxon_id`;

function toBackboneMatch(row: TaxonRow, acceptedScientificName: string | null): BackboneMatch {
  return {
    canonicalName: row.canonical_name,
    scientificName: row.scientific_name ?? row.canonical_name,
    taxonRank: row.taxon_rank,
    taxonomicStatus: row.taxonomic_status,
    vernacularName: row.vernacular_name,
    classification: {
      kingdom: row.kingdom,
      phylum: row.phylum,
      class: row.class,
      order: row.order,
      family: row.family,
      genus: row.genus,
    },
    acceptedScientificName,
  };
}

/**
 * Validates candidate "Genus species" binomials against the local GBIF
 * backbone, keeping only accepted/synonym species-rank matches (or, failing
 * that, an accepted/synonym subspecies-rank row whose canonical name starts
 * with "Genus species ", resolved to the parent binomial — same trinomial
 * fallback as the app's literature/backboneMatch.ts). When `taxonHint` is
 * given, only matches whose kingdom/phylum/class/order/family/genus equals
 * it (case-insensitive) are kept.
 *
 * Returns full classification/taxonomic-status/vernacular-name/synonym-
 * resolution data (used by analysis/gbifEnrichment.ts for the no-LLM
 * "Analyzing Species" enrichment step) — most existing callers only read
 * `.scientificName`/`.canonicalName`, which keeps working unchanged.
 */
/**
 * Strips a trailing scientific authorship clause before backbone lookup —
 * e.g. "Aethopyga ignicauda (Hodgson, 1836)" -> "Aethopyga ignicauda".
 * GBIF's canonical_name column never includes authorship, but LLM/regex
 * extraction commonly returns the full scientific name as the source paper
 * actually prints it (this function never overwrites the caller's own
 * `scientificName` — only the string used to query the backbone changes).
 * Without this, the exact-match query below silently fails for any name
 * carrying authorship, leaving `backboneValidated`/`acceptedScientificName`
 * unset even for perfectly real, resolvable species — which then also
 * breaks dedup against the same species discovered via other sources once
 * it reaches the app (see app/src/lib/taxonomy/backbone.server.ts, which
 * has the identical gap and the identical fix — intentionally duplicated
 * here since these two projects don't share imports, same precedent as the
 * manually-synced REVIEW_SCORE_THRESHOLD constant).
 *
 * Conservative: only trusts the stripped result when it still looks like a
 * normal 2-3 word alphabetic binomial/trinomial, so a genuinely unusual
 * name is never mangled into matching the wrong taxon.
 */
function stripAuthorship(name: string): string {
  const trimmed = name.trim();
  // Parenthetical form — by far the most common in extracted text, since
  // most names that changed genus (the majority of older/regional-checklist
  // names) are conventionally written this way: "(Hodgson, 1836)".
  let stripped = trimmed.replace(/\s*\([^()]*\)\s*$/, "").trim();
  // Unparenthesized form (original-genus authorship never gets parens):
  // "Linnaeus, 1758" trailing the binomial directly. Anchored on a comma
  // immediately before a 4-digit year so a genuine trinomial epithet is
  // never mistaken for an author name.
  if (stripped === trimmed) {
    stripped = trimmed
      .replace(/\s+[A-ZÀ-Þ][\p{L}.'-]*(?:\s*(?:&|and|et\s+al\.?)\s*[A-ZÀ-Þ]?[\p{L}.'-]*)*,\s*\d{4}\)?\s*$/u, "")
      .trim();
  }
  if (stripped === trimmed || stripped.length === 0) return trimmed;
  const words = stripped.split(/\s+/);
  if (words.length < 2 || words.length > 3 || !words.every((w) => /^[A-Za-zÀ-ÿ-]+$/.test(w))) return trimmed;
  return stripped;
}

export function matchAgainstBackbone(names: string[], taxonHint?: string): Map<string, BackboneMatch> {
  const database = getDb();
  const result = new Map<string, BackboneMatch>();
  if (!database) return result;

  const speciesStmt = database.prepare(
    `SELECT ${SELECT_COLUMNS} FROM gbif_taxa WHERE canonical_name = ? AND taxon_rank = 'species'`,
  );
  // GLOB, not LIKE: SQLite's LIKE defaults to ASCII case-insensitive
  // matching, which disables its index-range-scan optimization for a
  // prefix pattern (it can't be sure the index's BINARY collation order
  // matches case-insensitive comparison) — this query was doing a full
  // 5.5M-row table scan per call (~2.8s observed) instead of an index seek.
  // GLOB is always case-sensitive, which both matches what we want (exact
  // case scientific names) and lets the query planner use
  // idx_gbif_taxa_canonical as a real range scan (~0ms observed).
  const subspeciesStmt = database.prepare(
    `SELECT ${SELECT_COLUMNS} FROM gbif_taxa WHERE canonical_name GLOB ? AND taxon_rank = 'subspecies'`,
  );
  // Synonym -> accepted-name resolution, looked up only for matched rows
  // whose own taxonomic_status is "synonym" — most matches are "accepted",
  // so this avoids a query-per-name cost increase on the common path.
  const acceptedStmt = database.prepare(`SELECT canonical_name, scientific_name FROM gbif_taxa WHERE taxon_id = ?`);

  const hint = taxonHint?.toLowerCase();
  const matchesHint = (r: TaxonRow) =>
    !hint || [r.kingdom, r.phylum, r.class, r.order, r.family, r.genus].some((v) => v?.toLowerCase() === hint);
  const isUsable = (r: TaxonRow) => r.taxonomic_status === "accepted" || r.taxonomic_status === "synonym";

  function resolveAccepted(row: TaxonRow): string | null {
    if (row.taxonomic_status !== "synonym" || !row.accepted_taxon_id) return null;
    const accepted = acceptedStmt.get(row.accepted_taxon_id) as
      | { canonical_name: string; scientific_name: string | null }
      | undefined;
    return accepted ? accepted.scientific_name ?? accepted.canonical_name : null;
  }

  for (const name of names) {
    const cleanName = stripAuthorship(name);
    const rows = speciesStmt.all(cleanName) as TaxonRow[];
    const usable = rows.filter((r) => isUsable(r) && matchesHint(r));
    if (usable.length > 0) {
      const row = usable[0];
      result.set(name, toBackboneMatch(row, resolveAccepted(row)));
      continue;
    }

    const subspeciesRows = subspeciesStmt.all(`${cleanName} *`) as TaxonRow[];
    const usableSubspecies = subspeciesRows.filter((r) => isUsable(r) && matchesHint(r));
    if (usableSubspecies.length > 0) {
      const row = usableSubspecies[0];
      // Resolved to the parent binomial (`cleanName`, not the raw `name` —
      // which may still carry an authorship clause stripAuthorship removed
      // for the query above), but classification/status come from the real
      // matched subspecies row, not a placeholder.
      result.set(name, { ...toBackboneMatch(row, resolveAccepted(row)), canonicalName: cleanName, scientificName: cleanName });
    }
  }
  return result;
}
