/**
 * Server-only: direct access to the local GBIF backbone SQLite mirror.
 *
 * Shared between /api/taxonomy/normalize (batch UI endpoint) and
 * /api/checklists (used to normalize CSV-uploaded species at creation time
 * so synonym/outdated-name conflicts are flagged before the DB insert).
 *
 * Per AGENTS.md the backbone lives on the server filesystem, not Supabase.
 */

import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.join(process.cwd(), "data", "gbif-backbone.sqlite");

let _db: Database.Database | null = null;
let _selectCols: string | null = null;

function getDb(): Database.Database | null {
  if (_db) return _db;
  try {
    _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const cols = (_db.prepare("PRAGMA table_info(gbif_taxa)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );

    // Build the column list once so both lookup functions use the same query shape.
    // Guard every new column so old backbone builds degrade gracefully.
    const authCol = cols.includes("scientific_name_authorship")
      ? "scientific_name_authorship"
      : "NULL as scientific_name_authorship";
    const parentCol = cols.includes("parent_taxon_id")
      ? "parent_taxon_id"
      : "NULL as parent_taxon_id";
    const nameAccordingToCol = cols.includes("name_according_to")
      ? "name_according_to"
      : "NULL as name_according_to";
    const namePublishedInCol = cols.includes("name_published_in")
      ? "name_published_in"
      : "NULL as name_published_in";
    const namePublishedInYearCol = cols.includes("name_published_in_year")
      ? "name_published_in_year"
      : "NULL as name_published_in_year";
    const genericNameCol = cols.includes("generic_name")
      ? "generic_name"
      : "NULL as generic_name";
    const specificEpithetCol = cols.includes("specific_epithet")
      ? "specific_epithet"
      : "NULL as specific_epithet";

    if (!cols.includes("scientific_name_authorship")) {
      console.warn(
        "[backbone] scientific_name_authorship column not present — run `npm run build:backbone` to enable authorship data",
      );
    }
    if (!cols.includes("parent_taxon_id")) {
      console.warn(
        "[backbone] Enriched provenance columns not present — run `npm run build:backbone` to rebuild with full schema",
      );
    }

    _selectCols = `taxon_id, scientific_name, canonical_name, ${authCol},
            taxon_rank, taxonomic_status, accepted_taxon_id,
            kingdom, phylum, class, "order", family, genus,
            ${parentCol}, ${nameAccordingToCol}, ${namePublishedInCol},
            ${namePublishedInYearCol}, ${genericNameCol}, ${specificEpithetCol}`;
    return _db;
  } catch {
    return null;
  }
}

function selectCols(): string {
  return _selectCols!;
}

export interface TaxonRow {
  taxon_id: number;
  scientific_name: string | null;
  canonical_name: string | null;
  scientific_name_authorship: string | null;
  taxon_rank: string | null;
  taxonomic_status: string | null;
  accepted_taxon_id: number | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  // Enriched columns (null on old backbone builds)
  parent_taxon_id: number | null;
  name_according_to: string | null;
  name_published_in: string | null;
  name_published_in_year: number | null;
  generic_name: string | null;
  specific_epithet: string | null;
}

export interface VernacularNameRow {
  taxon_id: number;
  vernacular_name: string;
  language: string | null;
  country_code: string | null;
  is_preferred: number; // 0 | 1
}

export type NormalizeMatchType = "accepted" | "synonym" | "doubtful" | "none";

export interface BackboneResult {
  taxonKey: number | null;
  scientificName: string | null;
  canonicalName: string | null;
  /** Authorship string of the accepted taxon (e.g. "L." or "Müller, 1776") */
  authorship: string | null;
  rank: string | null;
  matchType: NormalizeMatchType;
  originalStatus: string | null;
  ownTaxonId: number | null;
  ownScientificName: string | null;
  /** Authorship string of the matched (possibly synonym) taxon */
  ownAuthorship: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
  /** Hierarchy of the matched (possibly synonym/doubtful) taxon itself — distinct
   * from `classification` above, which is always the ACCEPTED taxon's hierarchy.
   * For a synonym, genus/species here can differ from the accepted name's. */
  ownClassification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
  /** Year the matched (possibly synonym/doubtful) taxon's own name was published — distinct from `namePublishedInYear` (the accepted taxon's). */
  ownNamePublishedInYear: number | null;
  // Enriched provenance fields (null on old backbone builds)
  parentTaxonId: number | null;
  nameAccordingTo: string | null;
  namePublishedIn: string | null;
  namePublishedInYear: number | null;
  /** True when the queried name itself has no row on the backbone and this
   * result came from a common/vernacular-name fallback to a DIFFERENT taxon
   * (e.g. an outdated genus matched, by shared common name, to its current
   * accepted name). Callers should treat `ownAuthorship`/`authorship`/genus/
   * species as belonging to that other taxon, not the name that was queried —
   * only the higher ranks (kingdom..family) are safe to attribute back. */
  matchedViaCommonName?: boolean;
  /** True when the queried binomial wasn't found directly but matched the
   * trailing epithet of a backbone SUBSPECIES under the same genus — e.g.
   * "Butorides atricapilla" (no binomial entry on the backbone) resolving to
   * "Butorides striata atricapilla" (the subspecies GBIF actually carries that
   * epithet under). Older checklists often use the binomial form for a name
   * GBIF now only recognizes as infraspecific. `ownScientificName`/
   * `ownClassification` belong to that subspecies, not a true species. */
  matchedViaSubspeciesRank?: boolean;
}

const NO_MATCH: BackboneResult = {
  taxonKey: null,
  scientificName: null,
  canonicalName: null,
  authorship: null,
  rank: null,
  matchType: "none",
  originalStatus: null,
  ownTaxonId: null,
  ownScientificName: null,
  ownAuthorship: null,
  classification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null, species: null },
  ownClassification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null, species: null },
  ownNamePublishedInYear: null,
  parentTaxonId: null,
  nameAccordingTo: null,
  namePublishedIn: null,
  namePublishedInYear: null,
};

function toResult(matched: TaxonRow, accepted: TaxonRow): BackboneResult {
  let matchType: NormalizeMatchType =
    matched.taxonomic_status === "accepted"
      ? "accepted"
      : matched.taxonomic_status === "synonym"
        ? "synonym"
        : matched.taxonomic_status === "doubtful"
          ? "doubtful"
          : "none";

  // When resolveAccepted could not find the accepted row (accepted_taxon_id pointed
  // to a taxon filtered out of the backbone), it falls back to returning the synonym
  // row itself. In that case we must NOT use the synonym's own canonical_name as the
  // accepted name — they are equal to the imported name and would make the species
  // appear "clean". Return null so the caller knows the accepted name is unresolvable.
  const acceptedResolved = matched !== accepted;
  const canonicalName = (matchType === "synonym" && !acceptedResolved)
    ? null
    : accepted.canonical_name;

  // A synonym whose accepted taxon is itself doubtful means the name has no stable
  // accepted placement — escalate to conflict rather than outdated.
  if (matchType === "synonym" && accepted.taxonomic_status === "doubtful") {
    matchType = "doubtful";
  }

  return {
    taxonKey: accepted.taxon_id,
    scientificName: accepted.scientific_name,
    canonicalName,
    authorship: accepted.scientific_name_authorship,
    rank: accepted.taxon_rank,
    matchType,
    originalStatus: matched.taxonomic_status,
    ownTaxonId: matched.taxon_id,
    ownScientificName: matched.scientific_name,
    ownAuthorship: matched.scientific_name_authorship,
    classification: {
      kingdom: accepted.kingdom,
      phylum: accepted.phylum,
      class: accepted.class,
      order: accepted.order,
      family: accepted.family,
      genus: accepted.genus,
      // The backbone has no separate "species" column — canonicalName itself
      // IS the species-level binomial, so it's always derivable here. Without
      // this, every consumer of `classification` would need to remember to
      // fall back to canonicalName separately, and it kept getting missed.
      species: canonicalName,
    },
    ownClassification: {
      kingdom: matched.kingdom,
      phylum: matched.phylum,
      class: matched.class,
      order: matched.order,
      family: matched.family,
      genus: matched.genus,
      // Same rationale as `classification.species` above, but for the matched
      // (own) taxon's canonical name rather than the accepted taxon's.
      species: matched.canonical_name,
    },
    ownNamePublishedInYear: matched.name_published_in_year ?? null,
    parentTaxonId: accepted.parent_taxon_id ?? null,
    nameAccordingTo: accepted.name_according_to ?? null,
    namePublishedIn: accepted.name_published_in ?? null,
    namePublishedInYear: accepted.name_published_in_year ?? null,
  };
}

/**
 * Strips a trailing scientific authorship clause before backbone lookup —
 * e.g. "Aethopyga ignicauda (Hodgson, 1836)" -> "Aethopyga ignicauda".
 * GBIF's canonical_name column never includes authorship, but literature-
 * extracted names commonly do (that's how the source paper actually prints
 * a species' full scientific name) — without this, an otherwise-exact match
 * against canonical_name silently fails, producing a SEPARATE "unresolved"
 * row for the exact same species other sources (GBIF/eBird/iNat) already
 * resolved cleanly, since this app's aggregator buckets species by
 * resolved taxonKey, not by name string. The same gap breaks synonym
 * detection for literature-sourced historical names, which go through this
 * same exact-match path.
 *
 * Conservative: only trusts the stripped result when it still looks like a
 * normal 2-3 word alphabetic binomial/trinomial, so a genuinely unusual
 * name is never mangled into matching the wrong taxon. Intentionally
 * duplicated in research-pipeline/src/analysis/backboneMatch.ts (its own
 * extraction-time backbone check has the identical gap) — these two
 * projects deliberately don't share imports, same precedent as the
 * manually-synced REVIEW_SCORE_THRESHOLD constant.
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

/**
 * Normalize a single name or GBIF key against the local backbone.
 * Returns NO_MATCH when the backbone DB isn't available or no row matched.
 */
export function lookupBackbone(
  input: { gbifKey?: number; name?: string; commonName?: string },
  kingdomHint?: string,
): BackboneResult {
  const db = getDb();
  if (!db) return NO_MATCH;

  const cols = selectCols();
  const byKey = db.prepare<[number], TaxonRow>(
    `SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`,
  );
  const byCanonical = db.prepare<[string], TaxonRow>(
    `SELECT ${cols} FROM gbif_taxa WHERE LOWER(canonical_name) = LOWER(?)`,
  );

  const lookupKey = (key: number): TaxonRow | undefined =>
    byKey.get(key) as TaxonRow | undefined;

  const resolveAccepted = (row: TaxonRow): TaxonRow => {
    if (row.taxonomic_status === "accepted" || !row.accepted_taxon_id) return row;
    return lookupKey(row.accepted_taxon_id) ?? row;
  };

  const hint = kingdomHint?.toLowerCase();
  const score = (r: TaxonRow) =>
    (r.taxonomic_status === "accepted" ? 2 : r.taxonomic_status === "synonym" ? 1 : 0) +
    (hint && r.kingdom?.toLowerCase() === hint ? 4 : 0);

  let matched: TaxonRow | undefined;
  const cleanName = input.name ? stripAuthorship(input.name.trim()) : undefined;

  if (typeof input.gbifKey === "number" && Number.isFinite(input.gbifKey)) {
    matched = lookupKey(input.gbifKey);
  }
  if (!matched && cleanName) {
    const rows = byCanonical.all(cleanName) as TaxonRow[];
    matched = rows.length === 0 ? undefined : [...rows].sort((a, b) => score(b) - score(a))[0];
  }

  // Exact spelling failed — the backbone may register this taxon under a
  // different (but genuinely the same) orthographic variant, e.g. "malaiensis"
  // vs "malayensis". This is still a direct match on the real taxon (just a
  // different spelling), unlike the common-name fallback below.
  if (!matched && cleanName) {
    for (const variant of generateSpellingVariants(cleanName)) {
      const rows = byCanonical.all(variant) as TaxonRow[];
      if (rows.length > 0) {
        matched = [...rows].sort((a, b) => score(b) - score(a))[0];
        break;
      }
    }
  }

  // Old genus placement recorded only as the nominate-subspecies trinomial
  // synonym (genus split/lump where GBIF never created a binomial-level row).
  if (!matched && cleanName) {
    const nominate = generateNominateTrinomialCandidate(cleanName);
    if (nominate) {
      const rows = byCanonical.all(nominate) as TaxonRow[];
      if (rows.length > 0) matched = [...rows].sort((a, b) => score(b) - score(a))[0];
    }
  }

  if (matched) return toResult(matched, resolveAccepted(matched));

  // Exact spelling AND orthographic variants failed — the name may be a
  // binomial GBIF now only carries as an infraspecific epithet under a
  // different species (see findElevatedSubspeciesMatch).
  if (cleanName) {
    const elevated = findElevatedSubspeciesMatch(db, cols, cleanName, lookupKey);
    if (elevated) return elevated;
  }

  // Scientific name match failed (e.g. an authority's spelling isn't on the
  // backbone) — fall back to a vernacular/common-name lookup when one was given.
  if (input.commonName) {
    const byVernacular = lookupByVernacularName(input.commonName);
    if (byVernacular) return { ...byVernacular, matchedViaCommonName: true };
  }

  return NO_MATCH;
}

/**
 * Batch version: normalizes many inputs in one SQLite session (much faster
 * than calling lookupBackbone() repeatedly because the prepared statements
 * are reused across the whole batch).
 */
export function lookupBackboneBatch(
  items: Array<{ id: string; gbifKey?: number; name?: string; commonName?: string }>,
  kingdomHint?: string,
): Map<string, BackboneResult> {
  const out = new Map<string, BackboneResult>();
  const db = getDb();
  if (!db) {
    for (const item of items) out.set(item.id, NO_MATCH);
    return out;
  }

  const cols = selectCols();
  const byKey = db.prepare<[number], TaxonRow>(
    `SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`,
  );
  const byCanonical = db.prepare<[string], TaxonRow>(
    `SELECT ${cols} FROM gbif_taxa WHERE LOWER(canonical_name) = LOWER(?)`,
  );

  const cache = new Map<number, TaxonRow | undefined>();
  const lookupKey = (key: number): TaxonRow | undefined => {
    if (cache.has(key)) return cache.get(key);
    const row = byKey.get(key) as TaxonRow | undefined;
    cache.set(key, row);
    return row;
  };
  const resolveAccepted = (row: TaxonRow): TaxonRow => {
    if (row.taxonomic_status === "accepted" || !row.accepted_taxon_id) return row;
    return lookupKey(row.accepted_taxon_id) ?? row;
  };

  const hint = kingdomHint?.toLowerCase();
  const score = (r: TaxonRow) =>
    (r.taxonomic_status === "accepted" ? 2 : r.taxonomic_status === "synonym" ? 1 : 0) +
    (hint && r.kingdom?.toLowerCase() === hint ? 4 : 0);

  for (const item of items) {
    let matched: TaxonRow | undefined;
    const cleanName = item.name ? stripAuthorship(item.name.trim()) : undefined;
    if (typeof item.gbifKey === "number" && Number.isFinite(item.gbifKey)) {
      matched = lookupKey(item.gbifKey);
    }
    if (!matched && cleanName) {
      const rows = byCanonical.all(cleanName) as TaxonRow[];
      matched = rows.length === 0 ? undefined : [...rows].sort((a, b) => score(b) - score(a))[0];
    }
    // Exact spelling failed — try genuine orthographic variants (e.g.
    // "malaiensis" vs "malayensis") before falling back to a common-name lookup.
    if (!matched && cleanName) {
      for (const variant of generateSpellingVariants(cleanName)) {
        const rows = byCanonical.all(variant) as TaxonRow[];
        if (rows.length > 0) {
          matched = [...rows].sort((a, b) => score(b) - score(a))[0];
          break;
        }
      }
    }
    // Old genus placement recorded only as the nominate-subspecies trinomial
    // synonym (genus split/lump where GBIF never created a binomial-level row).
    if (!matched && cleanName) {
      const nominate = generateNominateTrinomialCandidate(cleanName);
      if (nominate) {
        const rows = byCanonical.all(nominate) as TaxonRow[];
        if (rows.length > 0) matched = [...rows].sort((a, b) => score(b) - score(a))[0];
      }
    }

    if (matched) {
      out.set(item.id, toResult(matched, resolveAccepted(matched)));
      continue;
    }

    // Exact spelling AND orthographic variants failed — try the elevated
    // infraspecific-epithet fallback before giving up on the scientific name.
    if (cleanName) {
      const elevated = findElevatedSubspeciesMatch(db, cols, cleanName, lookupKey);
      if (elevated) {
        out.set(item.id, elevated);
        continue;
      }
    }

    // Scientific name match failed — fall back to a vernacular/common-name lookup.
    const byVernacular = item.commonName ? lookupByVernacularName(item.commonName) : null;
    out.set(item.id, byVernacular ? { ...byVernacular, matchedViaCommonName: true } : NO_MATCH);
  }

  return out;
}

/**
 * Normalize a common/vernacular name for fuzzy comparison:
 * lowercases, replaces all non-alphanumeric characters with spaces,
 * collapses whitespace, strips leading/trailing qualifying words,
 * and trims the result.
 *
 * Used both by the backbone vernacular lookup (Pass 4) and the
 * within-batch cross-reference (Pass 5) in the ingestion pipeline,
 * so both sides of the comparison use identical normalization.
 */
export function normalizeVernacularName(raw: string): string {
  const base = normalizeCommonName(raw);
  return stripQualifiers(base);
}

// Latin digraphs that different taxonomic authorities transliterate
// differently for the same name (e.g. GBIF's "Ictinaetus malayensis" vs the
// "malaiensis" spelling some checklists import) — tried as exact-match
// candidates, one substitution at a time, before giving up on the spelling
// and falling back to a common-name lookup. Each pair only needs to be listed
// once; the reverse substitution is generated automatically.
const SPELLING_VARIANT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ai", "ay"],
  ["ae", "e"],
  ["oe", "e"],
  ["ei", "i"],
  ["ii", "i"],
];

/**
 * Generates candidate alternate spellings of a scientific name by swapping one
 * Latin digraph variant at a time (e.g. "Ictinaetus malaiensis" →
 * "Ictinaetus malayensis"). Each substitution is global within the name, so a
 * name with the digraph repeated produces one variant covering all
 * occurrences, not one variant per occurrence. Harmless when a variant
 * doesn't correspond to a real taxon — it simply won't match anything.
 */
function generateSpellingVariants(name: string): string[] {
  const variants = new Set<string>();
  const lower = name.toLowerCase();
  for (const [a, b] of SPELLING_VARIANT_PAIRS) {
    if (lower.includes(a)) {
      const variant = name.replace(new RegExp(a, "gi"), b);
      if (variant.toLowerCase() !== lower) variants.add(variant);
    }
    if (lower.includes(b)) {
      const variant = name.replace(new RegExp(b, "gi"), a);
      if (variant.toLowerCase() !== lower) variants.add(variant);
    }
  }
  variants.delete(name);
  return [...variants];
}

/**
 * Builds the "nominate trinomial" guess for a two-word binomial: genus +
 * epithet repeated as the infraspecific epithet (e.g. "Erythrogenys
 * erythrogenys" -> "Erythrogenys erythrogenys erythrogenys"). This is the
 * standard nomenclatural convention for a species' nominate subspecies, and
 * covers genus-split/lump cases where GBIF never recorded a binomial-level
 * row for the old genus placement — only the trinomial synonym pointing at
 * the accepted species under its current genus. Unlike the elevated-
 * subspecies-rank fallback below, this needs no genus-column filter (GBIF
 * stores the ACCEPTED genus there, not necessarily the queried one), since
 * it's an exact canonical_name lookup via the existing index.
 */
function generateNominateTrinomialCandidate(name: string): string | null {
  const words = name.trim().split(/\s+/);
  if (words.length !== 2) return null;
  const [genus, epithet] = words;
  if (!genus || !epithet) return null;
  return `${genus} ${epithet} ${epithet}`;
}

/**
 * Resolves the accepted SPECIES that a subspecies row belongs to, walking up
 * `parent_taxon_id` and then following `accepted_taxon_id` if that parent
 * itself isn't accepted (rare, but the same chain `resolveAccepted` already
 * follows for direct synonym rows). Returns null if there's no parent link
 * (old backbone build) or the parent row can't be found.
 */
function resolveParentSpecies(
  row: TaxonRow,
  lookupKey: (key: number) => TaxonRow | undefined,
): TaxonRow | null {
  if (!row.parent_taxon_id) return null;
  const parent = lookupKey(row.parent_taxon_id);
  if (!parent) return null;
  if (parent.taxonomic_status === "accepted" || !parent.accepted_taxon_id) return parent;
  return lookupKey(parent.accepted_taxon_id) ?? parent;
}

/**
 * Fallback for binomials that don't exist on the backbone as a species but DO
 * exist as the trailing epithet of an accepted SUBSPECIES under the same
 * genus — e.g. an older checklist's "Butorides atricapilla" (treated as a
 * full species) vs the backbone's "Butorides striata atricapilla" (GBIF now
 * carries that epithet only as infraspecific, under Butorides striata).
 *
 * Only fires for genuine two-word binomials (genus + epithet); anything else
 * is left to the normal match/spelling-variant/vernacular passes. Filters by
 * (genus, taxon_rank = 'subspecies') first — backed by idx_gbif_taxa_genus_rank
 * — then confirms the LAST word of the candidate's canonical name (the actual
 * infraspecific epithet) matches, since the LIKE-free SQL filter alone can't
 * express "trailing word equals X" precisely.
 *
 * Returns null when ambiguous — i.e. the epithet is shared by subspecies of
 * more than one distinct parent species in this genus (can't safely pick one).
 */
function findElevatedSubspeciesMatch(
  db: Database.Database,
  cols: string,
  name: string,
  lookupKey: (key: number) => TaxonRow | undefined,
): BackboneResult | null {
  const words = name.trim().split(/\s+/);
  if (words.length !== 2) return null;
  const [genusWord, epithet] = words;
  if (!genusWord || !epithet) return null;
  const genus = genusWord.charAt(0).toUpperCase() + genusWord.slice(1).toLowerCase();

  const candidates = db
    .prepare<[string], TaxonRow>(`SELECT ${cols} FROM gbif_taxa WHERE genus = ? AND taxon_rank = 'subspecies'`)
    .all(genus) as TaxonRow[];

  const epithetLower = epithet.toLowerCase();
  const exact = candidates.filter((r) => {
    const tokens = (r.canonical_name ?? "").trim().split(/\s+/);
    return tokens.length >= 2 && tokens[tokens.length - 1].toLowerCase() === epithetLower;
  });
  if (exact.length === 0) return null;

  const parents = exact
    .map((r) => resolveParentSpecies(r, lookupKey))
    .filter((p): p is TaxonRow => !!p);
  if (parents.length === 0) return null;

  const distinctParentIds = new Set(parents.map((p) => p.taxon_id));
  if (distinctParentIds.size > 1) return null; // genuinely ambiguous across species

  const result = toResult(exact[0], parents[0]);
  result.matchType = "synonym";
  result.matchedViaSubspeciesRank = true;
  return result;
}

// Replace ALL non-alphanumeric characters with spaces, collapse, trim.
function normalizeCommonName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Leading qualifier prefixes and trailing region suffixes added by some data sources.
const LEADING_QUALIFIER_RE =
  /^(eastern|western|northern|southern|common|greater|lesser|rufous|black|white|red|blue|grey|gray|large|small|little|great|long|short|pale|dark|african|asian|indian|american|european|australian|spotted|streaked|striped|variable)\s+/;
const TRAILING_QUALIFIER_RE =
  /,?\s+(eastern|western|northern|southern|common|greater|lesser)\s*$/;

function stripQualifiers(name: string): string {
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(LEADING_QUALIFIER_RE, "");
  }
  return name.replace(TRAILING_QUALIFIER_RE, "").trim();
}

/**
 * Fuzzy lookup: find a backbone taxon by English common name.
 *
 * Three improvements over a naïve LIKE search:
 *   1. All non-alphanumeric chars (apostrophes, slashes, parens, hyphens) → space.
 *   2. English-only filter (language IN 'eng'/'en') — prevents French/German/Hindi
 *      vernacular rows for different taxa from causing false "ambiguous" rejections.
 *   3. Accepted-taxon convergence: if multiple taxon_ids all share the same
 *      accepted_taxon_id (species + its synonyms), the match is unambiguous.
 *
 * Two strategies tried in order:
 *   Strategy 1 — full normalized name (no qualifier stripping)
 *   Strategy 2 — after stripping leading/trailing qualifier words
 *
 * Returns null when 0 matches or when multiple distinct accepted taxa match
 * (genuinely ambiguous — leave as unresolved for the user to decide).
 */
export function lookupByVernacularName(commonName: string): BackboneResult | null {
  const db = getDb();
  if (!db) return null;

  // Guard: table absent in old backbone builds.
  try {
    db.prepare("SELECT 1 FROM gbif_vernacular_names LIMIT 1").get();
  } catch {
    return null;
  }

  const cols = selectCols();

  function tryMatch(name: string): BackboneResult | null {
    const normalized = normalizeCommonName(name);
    // Min token length 3 — catches "Owl", "Jay", "Kite" (safe because English-only reduces noise).
    const tokens = normalized.split(" ").filter((w) => w.length >= 3);
    if (tokens.length === 0) return null;

    const conditions = tokens
      .map(() => "LOWER(gvn.vernacular_name) LIKE ?")
      .join(" AND ");
    const params = tokens.map((t) => `%${t}%`);

    let rows: Array<{ taxon_id: number; accepted_taxon_id: number | null; vernacular_name: string }>;
    try {
      rows = db!
        .prepare(
          `SELECT DISTINCT gvn.taxon_id, gt.accepted_taxon_id, gvn.vernacular_name
           FROM gbif_vernacular_names gvn
           JOIN gbif_taxa gt ON gt.taxon_id = gvn.taxon_id
           WHERE gvn.language IN ('eng', 'en')
             AND ${conditions}`,
        )
        .all(...params) as Array<{ taxon_id: number; accepted_taxon_id: number | null; vernacular_name: string }>;
    } catch {
      return null;
    }

    if (rows.length === 0) return null;

    // The LIKE conditions only require every token to appear as a substring, so
    // "Jungle Babbler" also matches unrelated species like "Abbott's Jungle
    // Babbler" or "Black-browed Jungle-babbler". Prefer rows whose vernacular
    // name normalizes to exactly the input before falling back to the full
    // (looser) match set — exact hits should never be treated as ambiguous just
    // because a longer, unrelated name happens to contain the same words.
    const exactRows = rows.filter((r) => normalizeCommonName(r.vernacular_name) === normalized);
    const candidateRows = exactRows.length > 0 ? exactRows : rows;

    // All matched rows must resolve to the same accepted taxon.
    const acceptedIds = new Set(candidateRows.map((r) => r.accepted_taxon_id ?? r.taxon_id));
    if (acceptedIds.size !== 1) {
      // Genuinely ambiguous — e.g. an unstable genus that's been split several
      // ways across authorities, with the same common name registered under
      // each placement (a real-world case: "Rusty-cheeked Scimitar Babbler"
      // matches both Pomatorhinus erythrogenys and Megapomatorhinus
      // erythrogenys on the backbone). We can't safely pick one taxon's
      // identity, genus, species, or authority, but if every candidate agrees
      // on kingdom..family, that much is still safe to surface instead of
      // leaving the whole hierarchy blank.
      const acceptedRows = [...acceptedIds]
        .map((id) => db!.prepare<[number], TaxonRow>(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`).get(id))
        .filter((r): r is TaxonRow => !!r);
      if (acceptedRows.length < 2) return null;
      const higherRanksAgree = (["kingdom", "phylum", "class", "order", "family"] as const).every(
        (rank) => new Set(acceptedRows.map((r) => r[rank])).size === 1,
      );
      if (!higherRanksAgree) return null;
      const sample = acceptedRows[0];
      return {
        ...NO_MATCH,
        classification: {
          kingdom: sample.kingdom,
          phylum: sample.phylum,
          class: sample.class,
          order: sample.order,
          family: sample.family,
          genus: null,
          species: null,
        },
      };
    }

    const acceptedId = [...acceptedIds][0];
    const acceptedRow = db!
      .prepare<[number], TaxonRow>(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`)
      .get(acceptedId) as TaxonRow | undefined;
    if (!acceptedRow) return null;

    // Use the first matched row as the "own" row for toResult().
    const ownRow = db!
      .prepare<[number], TaxonRow>(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`)
      .get(candidateRows[0].taxon_id) as TaxonRow | undefined;

    return toResult(ownRow ?? acceptedRow, acceptedRow);
  }

  // Strategy 1: full normalized name.
  const result = tryMatch(commonName);
  if (result) return result;

  // Strategy 2: after stripping leading/trailing qualifiers.
  const stripped = stripQualifiers(normalizeCommonName(commonName));
  if (stripped === normalizeCommonName(commonName)) return null; // nothing was stripped
  return tryMatch(stripped);
}

function hasRealHierarchy(c: BackboneResult["classification"]): boolean {
  return Boolean(c.kingdom || c.phylum || c.class || c.order || c.family || c.genus || c.species);
}

export interface ExhaustiveLookupCandidates {
  gbifKey?: number;
  /** Scientific names to try, in priority order — own/canonical name first,
   * then any other known names (recorded synonyms, basionyms, imported name). */
  names?: (string | undefined | null)[];
  /** Vernacular/common names to try, in priority order — a species can be
   * known by several (e.g. "Medium Egret" vs "Intermediate Egret" for the
   * same taxon), and different sources may report different ones. */
  commonNames?: (string | undefined | null)[];
  kingdomHint?: string;
}

/**
 * Last-resort fallback lookup: tries every piece of identifying information
 * available for a row, in priority order, stopping at the first candidate
 * that resolves AND carries real taxonomic hierarchy —
 *   1. gbifKey (exact, authoritative)
 *   2. each scientific name candidate (own name, then synonyms/basionyms)
 *   3. each vernacular/common name candidate
 * If every candidate fails to produce hierarchy data, returns whichever
 * candidate at least matched a taxon (better than nothing — callers still get
 * authorship/taxonKey), or NO_MATCH if nothing matched at all.
 *
 * Used both as a final ingestion-time fallback pass and by the on-demand
 * runtime enrichment fetcher for rows that fall through every earlier,
 * cheaper pass (a single direct name/key match).
 */
export function lookupBackboneExhaustive(candidates: ExhaustiveLookupCandidates): BackboneResult {
  const { gbifKey, names = [], commonNames = [], kingdomHint } = candidates;
  let best: BackboneResult | null = null;

  const consider = (result: BackboneResult | null): boolean => {
    if (!result || result.matchType === "none") return false;
    if (!best) best = result;
    return hasRealHierarchy(result.classification) || hasRealHierarchy(result.ownClassification);
  };

  if (typeof gbifKey === "number" && Number.isFinite(gbifKey)) {
    if (consider(lookupBackbone({ gbifKey }, kingdomHint))) return best!;
  }

  const seenNames = new Set<string>();
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed || seenNames.has(trimmed.toLowerCase())) continue;
    seenNames.add(trimmed.toLowerCase());
    if (consider(lookupBackbone({ name: trimmed }, kingdomHint))) return best!;
  }

  const seenCommonNames = new Set<string>();
  for (const commonName of commonNames) {
    const trimmed = commonName?.trim();
    if (!trimmed || seenCommonNames.has(trimmed.toLowerCase())) continue;
    seenCommonNames.add(trimmed.toLowerCase());
    const result = lookupByVernacularName(trimmed);
    if (consider(result)) return { ...best!, matchedViaCommonName: true };
  }

  return best ?? NO_MATCH;
}

/**
 * Fetch subspecies, varieties, and forms whose parent is the given taxon.
 * Returns an empty array if parent_taxon_id column is absent (old backbone build).
 */
export function getSubspecies(
  taxonId: number,
): Array<{ taxon_id: number; scientific_name: string | null; vernacular_name: string | null }> {
  const db = getDb();
  if (!db) return [];
  const cols = (db.prepare("PRAGMA table_info(gbif_taxa)").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
  if (!cols.includes("parent_taxon_id")) return [];
  try {
    return db
      .prepare(
        `SELECT taxon_id, scientific_name, vernacular_name
         FROM gbif_taxa
         WHERE parent_taxon_id = ?
           AND taxon_rank IN ('subspecies', 'variety', 'form')
         ORDER BY scientific_name ASC
         LIMIT 50`,
      )
      .all(taxonId) as Array<{
      taxon_id: number;
      scientific_name: string | null;
      vernacular_name: string | null;
    }>;
  } catch {
    return [];
  }
}

/**
 * Fetch all vernacular names for a taxon from the gbif_vernacular_names table.
 * Returns an empty array if the table doesn't exist (old backbone build) or no rows found.
 */
export function getVernacularNames(taxonId: number): VernacularNameRow[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[number], VernacularNameRow>(
        `SELECT taxon_id, vernacular_name, language, country_code, is_preferred
         FROM gbif_vernacular_names WHERE taxon_id = ?
         ORDER BY is_preferred DESC, language ASC`,
      )
      .all(taxonId);
    return rows as VernacularNameRow[];
  } catch {
    // Table doesn't exist in old backbone build.
    return [];
  }
}

export interface BackboneSuggestion {
  taxonId: number;
  scientificName: string | null;
  canonicalName: string | null;
  authorship: string | null;
  year: number | null;
  rank: string | null;
  taxonomicStatus: string | null;
  commonName: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
}

/**
 * Type-ahead search used by the manual taxonomy edit form: as the user types
 * a scientific name, surface live backbone candidates (name, common name,
 * taxon ID, hierarchy) so they can pick a real taxon instead of free-typing
 * one that may not match GBIF at all. Prefix-matches canonical_name first
 * (the common "starts typing the genus" case), falling back to a substring
 * match so a mid-name typo/partial still surfaces something.
 */
export function searchBackbone(query: string, limit = 8): BackboneSuggestion[] {
  const db = getDb();
  const trimmed = query.trim();
  if (!db || trimmed.length < 2) return [];

  const cols = selectCols();
  const prefixParam = `${trimmed}%`;
  const substringParam = `%${trimmed}%`;

  let rows: TaxonRow[];
  try {
    rows = db
      .prepare<[string, string, string, number], TaxonRow>(
        `SELECT ${cols} FROM gbif_taxa
         WHERE taxon_rank IN ('species', 'subspecies', 'variety', 'form')
           AND (LOWER(canonical_name) LIKE LOWER(?) OR LOWER(canonical_name) LIKE LOWER(?))
         ORDER BY
           CASE WHEN LOWER(canonical_name) LIKE LOWER(?) THEN 0 ELSE 1 END,
           taxonomic_status = 'accepted' DESC,
           LENGTH(canonical_name) ASC
         LIMIT ?`,
      )
      .all(prefixParam, substringParam, prefixParam, limit) as TaxonRow[];
  } catch {
    return [];
  }

  const vernacularByTaxonId = new Map<number, string>();
  try {
    const ids = rows.map((r) => r.taxon_id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const vRows = db
        .prepare(
          `SELECT taxon_id, vernacular_name FROM gbif_vernacular_names
           WHERE taxon_id IN (${placeholders}) AND language IN ('eng', 'en')
           ORDER BY is_preferred DESC`,
        )
        .all(...ids) as Array<{ taxon_id: number; vernacular_name: string }>;
      // First row per taxon wins (ORDER BY already prefers is_preferred) — built
      // with a loop rather than `new Map(vRows.map(...))` since the latter would
      // let a later, less-preferred row for the same taxon overwrite the first.
      for (const r of vRows) {
        if (!vernacularByTaxonId.has(r.taxon_id)) vernacularByTaxonId.set(r.taxon_id, r.vernacular_name);
      }
    }
  } catch {
    // Table absent in old backbone build — leave commonName null.
  }

  return rows.map((r) => ({
    taxonId: r.taxon_id,
    scientificName: r.scientific_name,
    canonicalName: r.canonical_name,
    authorship: r.scientific_name_authorship,
    year: r.name_published_in_year ?? null,
    rank: r.taxon_rank,
    taxonomicStatus: r.taxonomic_status,
    commonName: vernacularByTaxonId.get(r.taxon_id) ?? null,
    classification: {
      kingdom: r.kingdom,
      phylum: r.phylum,
      class: r.class,
      order: r.order,
      family: r.family,
      genus: r.genus,
      species: r.canonical_name,
    },
  }));
}
