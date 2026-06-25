import path from "node:path";
import Database from "better-sqlite3";

// Local-disk GBIF backbone mirror (see src/app/api/taxonomy/normalize/route.ts
// for the canonical reader). Used here to validate candidate binomial names
// extracted from literature titles/abstracts against real species — without
// requiring any LLM/API key.
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

interface TaxonRow {
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
}

export interface BackboneSpeciesMatch {
  canonicalName: string;
  scientificName: string;
}

/**
 * Validates a set of candidate "Genus species" binomial strings against the
 * local GBIF backbone, keeping only accepted/synonym species-rank matches —
 * or, if no species-rank row matches, an accepted/synonym subspecies-rank
 * row whose canonical name starts with "Genus species " (a trinomial
 * mention), resolved to the parent species binomial.
 * When `taxonHint` is given (e.g. "Aves"), only matches whose
 * kingdom/phylum/class/order/family/genus includes that value are kept —
 * this scopes literature-extracted species to the taxonomic group the
 * checklist is being built for (a regional survey paper often mentions
 * species from several unrelated groups).
 */
export function matchCanonicalSpecies(names: string[], taxonHint?: string): Map<string, BackboneSpeciesMatch> {
  const database = getDb();
  const result = new Map<string, BackboneSpeciesMatch>();
  if (!database) return result;

  const speciesStmt = database.prepare(
    `SELECT canonical_name, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus, taxonomic_status
       FROM gbif_taxa WHERE canonical_name = ? AND taxon_rank = 'species'`,
  );
  // Trinomial mentions ("Genus species subspecies") never match the
  // species-rank query above; fall back to a subspecies-rank row whose
  // canonical name starts with "Genus species " and resolve to the parent
  // species binomial.
  // GLOB, not LIKE: SQLite's LIKE defaults to ASCII case-insensitive
  // matching, which disables its index-range-scan optimization for a
  // prefix pattern — this was a full ~5.5M-row table scan per call (~2.8s
  // observed in research-pipeline's identical query) instead of an index
  // seek. GLOB is always case-sensitive (which is also what we actually
  // want for exact-case scientific names) and lets the planner use
  // idx_gbif_taxa_canonical as a real range scan.
  const subspeciesStmt = database.prepare(
    `SELECT canonical_name, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus, taxonomic_status
       FROM gbif_taxa WHERE canonical_name GLOB ? AND taxon_rank = 'subspecies'`,
  );

  const hint = taxonHint?.toLowerCase();
  const matchesHint = (r: TaxonRow) =>
    !hint ||
    [r.kingdom, r.phylum, r.class, r.order, r.family, r.genus].some((v) => v?.toLowerCase() === hint);
  const isUsable = (r: TaxonRow) => r.taxonomic_status === "accepted" || r.taxonomic_status === "synonym";

  for (const name of names) {
    const rows = speciesStmt.all(name) as TaxonRow[];
    const usable = rows.filter((r) => isUsable(r) && matchesHint(r));
    if (usable.length > 0) {
      const row = usable[0];
      result.set(name, { canonicalName: row.canonical_name, scientificName: row.scientific_name ?? row.canonical_name });
      continue;
    }

    const subspeciesRows = subspeciesStmt.all(`${name} *`) as TaxonRow[];
    const usableSubspecies = subspeciesRows.filter((r) => isUsable(r) && matchesHint(r));
    if (usableSubspecies.length > 0) {
      result.set(name, { canonicalName: name, scientificName: name });
    }
  }
  return result;
}
