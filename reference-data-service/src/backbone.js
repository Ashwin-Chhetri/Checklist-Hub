// Ported verbatim from app/src/lib/taxonomy/backbone.server.ts — same lookup
// logic (spelling variants, vernacular fallback, elevated-subspecies match),
// just running against the local SQLite file on this box instead of inside
// the Next.js server. Keep these two in sync if the matching logic changes;
// the Next.js side is now a thin HTTP client calling the endpoints this
// module backs (see server.js).
const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "gbif-backbone.sqlite");

let _db = null;
let _selectCols = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const cols = _db.prepare("PRAGMA table_info(gbif_taxa)").all().map((c) => c.name);

  const authCol = cols.includes("scientific_name_authorship") ? "scientific_name_authorship" : "NULL as scientific_name_authorship";
  const parentCol = cols.includes("parent_taxon_id") ? "parent_taxon_id" : "NULL as parent_taxon_id";
  const nameAccordingToCol = cols.includes("name_according_to") ? "name_according_to" : "NULL as name_according_to";
  const namePublishedInCol = cols.includes("name_published_in") ? "name_published_in" : "NULL as name_published_in";
  const namePublishedInYearCol = cols.includes("name_published_in_year") ? "name_published_in_year" : "NULL as name_published_in_year";
  const genericNameCol = cols.includes("generic_name") ? "generic_name" : "NULL as generic_name";
  const specificEpithetCol = cols.includes("specific_epithet") ? "specific_epithet" : "NULL as specific_epithet";

  _selectCols = `taxon_id, scientific_name, canonical_name, ${authCol},
          taxon_rank, taxonomic_status, accepted_taxon_id,
          kingdom, phylum, class, "order", family, genus,
          ${parentCol}, ${nameAccordingToCol}, ${namePublishedInCol},
          ${namePublishedInYearCol}, ${genericNameCol}, ${specificEpithetCol}`;
  return _db;
}

function selectCols() {
  return _selectCols;
}

const NO_MATCH = {
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

function toResult(matched, accepted) {
  let matchType =
    matched.taxonomic_status === "accepted"
      ? "accepted"
      : matched.taxonomic_status === "synonym"
        ? "synonym"
        : matched.taxonomic_status === "doubtful"
          ? "doubtful"
          : "none";

  const acceptedResolved = matched !== accepted;
  const canonicalName = (matchType === "synonym" && !acceptedResolved) ? null : accepted.canonical_name;

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
      species: canonicalName,
    },
    ownClassification: {
      kingdom: matched.kingdom,
      phylum: matched.phylum,
      class: matched.class,
      order: matched.order,
      family: matched.family,
      genus: matched.genus,
      species: matched.canonical_name,
    },
    ownNamePublishedInYear: matched.name_published_in_year ?? null,
    parentTaxonId: accepted.parent_taxon_id ?? null,
    nameAccordingTo: accepted.name_according_to ?? null,
    namePublishedIn: accepted.name_published_in ?? null,
    namePublishedInYear: accepted.name_published_in_year ?? null,
  };
}

function stripAuthorship(name) {
  const trimmed = name.trim();
  let stripped = trimmed.replace(/\s*\([^()]*\)\s*$/, "").trim();
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

const SPELLING_VARIANT_PAIRS = [
  ["ai", "ay"],
  ["ae", "e"],
  ["oe", "e"],
  ["ei", "i"],
  ["ii", "i"],
];

function generateSpellingVariants(name) {
  const variants = new Set();
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

function generateNominateTrinomialCandidate(name) {
  const words = name.trim().split(/\s+/);
  if (words.length !== 2) return null;
  const [genus, epithet] = words;
  if (!genus || !epithet) return null;
  return `${genus} ${epithet} ${epithet}`;
}

function resolveParentSpecies(row, lookupKey) {
  if (!row.parent_taxon_id) return null;
  const parent = lookupKey(row.parent_taxon_id);
  if (!parent) return null;
  if (parent.taxonomic_status === "accepted" || !parent.accepted_taxon_id) return parent;
  return lookupKey(parent.accepted_taxon_id) ?? parent;
}

function findElevatedSubspeciesMatch(db, cols, name, lookupKey) {
  const words = name.trim().split(/\s+/);
  if (words.length !== 2) return null;
  const [genusWord, epithet] = words;
  if (!genusWord || !epithet) return null;
  const genus = genusWord.charAt(0).toUpperCase() + genusWord.slice(1).toLowerCase();

  const candidates = db
    .prepare(`SELECT ${cols} FROM gbif_taxa WHERE genus = ? AND taxon_rank = 'subspecies'`)
    .all(genus);

  const epithetLower = epithet.toLowerCase();
  const exact = candidates.filter((r) => {
    const tokens = (r.canonical_name ?? "").trim().split(/\s+/);
    return tokens.length >= 2 && tokens[tokens.length - 1].toLowerCase() === epithetLower;
  });
  if (exact.length === 0) return null;

  const parents = exact.map((r) => resolveParentSpecies(r, lookupKey)).filter(Boolean);
  if (parents.length === 0) return null;

  const distinctParentIds = new Set(parents.map((p) => p.taxon_id));
  if (distinctParentIds.size > 1) return null;

  const result = toResult(exact[0], parents[0]);
  result.matchType = "synonym";
  result.matchedViaSubspeciesRank = true;
  return result;
}

function normalizeCommonName(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

const LEADING_QUALIFIER_RE =
  /^(eastern|western|northern|southern|common|greater|lesser|rufous|black|white|red|blue|grey|gray|large|small|little|great|long|short|pale|dark|african|asian|indian|american|european|australian|spotted|streaked|striped|variable)\s+/;
const TRAILING_QUALIFIER_RE = /,?\s+(eastern|western|northern|southern|common|greater|lesser)\s*$/;

function stripQualifiers(name) {
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(LEADING_QUALIFIER_RE, "");
  }
  return name.replace(TRAILING_QUALIFIER_RE, "").trim();
}

function normalizeVernacularName(raw) {
  return stripQualifiers(normalizeCommonName(raw));
}

function lookupByVernacularName(commonName) {
  const db = getDb();

  try {
    db.prepare("SELECT 1 FROM gbif_vernacular_names LIMIT 1").get();
  } catch {
    return null;
  }

  const cols = selectCols();

  function tryMatch(name) {
    const normalized = normalizeCommonName(name);
    const tokens = normalized.split(" ").filter((w) => w.length >= 3);
    if (tokens.length === 0) return null;

    const conditions = tokens.map(() => "LOWER(gvn.vernacular_name) LIKE ?").join(" AND ");
    const params = tokens.map((t) => `%${t}%`);

    let rows;
    try {
      rows = db
        .prepare(
          `SELECT DISTINCT gvn.taxon_id, gt.accepted_taxon_id, gvn.vernacular_name
           FROM gbif_vernacular_names gvn
           JOIN gbif_taxa gt ON gt.taxon_id = gvn.taxon_id
           WHERE gvn.language IN ('eng', 'en')
             AND ${conditions}`,
        )
        .all(...params);
    } catch {
      return null;
    }

    if (rows.length === 0) return null;

    const exactRows = rows.filter((r) => normalizeCommonName(r.vernacular_name) === normalized);
    const candidateRows = exactRows.length > 0 ? exactRows : rows;

    const acceptedIds = new Set(candidateRows.map((r) => r.accepted_taxon_id ?? r.taxon_id));
    if (acceptedIds.size !== 1) {
      const acceptedRows = [...acceptedIds]
        .map((id) => db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`).get(id))
        .filter(Boolean);
      if (acceptedRows.length < 2) return null;
      const higherRanksAgree = ["kingdom", "phylum", "class", "order", "family"].every(
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
    const acceptedRow = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`).get(acceptedId);
    if (!acceptedRow) return null;

    const ownRow = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`).get(candidateRows[0].taxon_id);

    return toResult(ownRow ?? acceptedRow, acceptedRow);
  }

  const result = tryMatch(commonName);
  if (result) return result;

  const stripped = stripQualifiers(normalizeCommonName(commonName));
  if (stripped === normalizeCommonName(commonName)) return null;
  return tryMatch(stripped);
}

function lookupBackbone(input, kingdomHint) {
  const db = getDb();
  const cols = selectCols();
  const byKey = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`);
  const byCanonical = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE LOWER(canonical_name) = LOWER(?)`);

  const lookupKey = (key) => byKey.get(key);
  const resolveAccepted = (row) => {
    if (row.taxonomic_status === "accepted" || !row.accepted_taxon_id) return row;
    return lookupKey(row.accepted_taxon_id) ?? row;
  };

  const hint = kingdomHint?.toLowerCase();
  const score = (r) =>
    (r.taxonomic_status === "accepted" ? 2 : r.taxonomic_status === "synonym" ? 1 : 0) +
    (hint && r.kingdom?.toLowerCase() === hint ? 4 : 0);

  let matched;
  const cleanName = input.name ? stripAuthorship(input.name.trim()) : undefined;

  if (typeof input.gbifKey === "number" && Number.isFinite(input.gbifKey)) {
    matched = lookupKey(input.gbifKey);
  }
  if (!matched && cleanName) {
    const rows = byCanonical.all(cleanName);
    matched = rows.length === 0 ? undefined : [...rows].sort((a, b) => score(b) - score(a))[0];
  }
  if (!matched && cleanName) {
    for (const variant of generateSpellingVariants(cleanName)) {
      const rows = byCanonical.all(variant);
      if (rows.length > 0) {
        matched = [...rows].sort((a, b) => score(b) - score(a))[0];
        break;
      }
    }
  }
  if (!matched && cleanName) {
    const nominate = generateNominateTrinomialCandidate(cleanName);
    if (nominate) {
      const rows = byCanonical.all(nominate);
      if (rows.length > 0) matched = [...rows].sort((a, b) => score(b) - score(a))[0];
    }
  }

  if (matched) return toResult(matched, resolveAccepted(matched));

  if (cleanName) {
    const elevated = findElevatedSubspeciesMatch(db, cols, cleanName, lookupKey);
    if (elevated) return elevated;
  }

  if (input.commonName) {
    const byVernacular = lookupByVernacularName(input.commonName);
    if (byVernacular) return { ...byVernacular, matchedViaCommonName: true };
  }

  return NO_MATCH;
}

function lookupBackboneBatch(items, kingdomHint) {
  const out = {};
  const db = getDb();
  const cols = selectCols();
  const byKey = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE taxon_id = ?`);
  const byCanonical = db.prepare(`SELECT ${cols} FROM gbif_taxa WHERE LOWER(canonical_name) = LOWER(?)`);

  const cache = new Map();
  const lookupKey = (key) => {
    if (cache.has(key)) return cache.get(key);
    const row = byKey.get(key);
    cache.set(key, row);
    return row;
  };
  const resolveAccepted = (row) => {
    if (row.taxonomic_status === "accepted" || !row.accepted_taxon_id) return row;
    return lookupKey(row.accepted_taxon_id) ?? row;
  };

  const hint = kingdomHint?.toLowerCase();
  const score = (r) =>
    (r.taxonomic_status === "accepted" ? 2 : r.taxonomic_status === "synonym" ? 1 : 0) +
    (hint && r.kingdom?.toLowerCase() === hint ? 4 : 0);

  for (const item of items) {
    let matched;
    const cleanName = item.name ? stripAuthorship(item.name.trim()) : undefined;
    if (typeof item.gbifKey === "number" && Number.isFinite(item.gbifKey)) {
      matched = lookupKey(item.gbifKey);
    }
    if (!matched && cleanName) {
      const rows = byCanonical.all(cleanName);
      matched = rows.length === 0 ? undefined : [...rows].sort((a, b) => score(b) - score(a))[0];
    }
    if (!matched && cleanName) {
      for (const variant of generateSpellingVariants(cleanName)) {
        const rows = byCanonical.all(variant);
        if (rows.length > 0) {
          matched = [...rows].sort((a, b) => score(b) - score(a))[0];
          break;
        }
      }
    }
    if (!matched && cleanName) {
      const nominate = generateNominateTrinomialCandidate(cleanName);
      if (nominate) {
        const rows = byCanonical.all(nominate);
        if (rows.length > 0) matched = [...rows].sort((a, b) => score(b) - score(a))[0];
      }
    }

    if (matched) {
      out[item.id] = toResult(matched, resolveAccepted(matched));
      continue;
    }

    if (cleanName) {
      const elevated = findElevatedSubspeciesMatch(db, cols, cleanName, lookupKey);
      if (elevated) {
        out[item.id] = elevated;
        continue;
      }
    }

    const byVernacular = item.commonName ? lookupByVernacularName(item.commonName) : null;
    out[item.id] = byVernacular ? { ...byVernacular, matchedViaCommonName: true } : NO_MATCH;
  }

  return out;
}

function hasRealHierarchy(c) {
  return Boolean(c.kingdom || c.phylum || c.class || c.order || c.family || c.genus || c.species);
}

function lookupBackboneExhaustive(candidates) {
  const { gbifKey, names = [], commonNames = [], kingdomHint } = candidates;
  let best = null;

  const consider = (result) => {
    if (!result || result.matchType === "none") return false;
    if (!best) best = result;
    return hasRealHierarchy(result.classification) || hasRealHierarchy(result.ownClassification);
  };

  if (typeof gbifKey === "number" && Number.isFinite(gbifKey)) {
    if (consider(lookupBackbone({ gbifKey }, kingdomHint))) return best;
  }

  const seenNames = new Set();
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed || seenNames.has(trimmed.toLowerCase())) continue;
    seenNames.add(trimmed.toLowerCase());
    if (consider(lookupBackbone({ name: trimmed }, kingdomHint))) return best;
  }

  const seenCommonNames = new Set();
  for (const commonName of commonNames) {
    const trimmed = commonName?.trim();
    if (!trimmed || seenCommonNames.has(trimmed.toLowerCase())) continue;
    seenCommonNames.add(trimmed.toLowerCase());
    const result = lookupByVernacularName(trimmed);
    if (consider(result)) return { ...best, matchedViaCommonName: true };
  }

  return best ?? NO_MATCH;
}

function getSubspecies(taxonId) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(gbif_taxa)").all().map((r) => r.name);
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
      .all(taxonId);
  } catch {
    return [];
  }
}

function getVernacularNames(taxonId) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT taxon_id, vernacular_name, language, country_code, is_preferred
         FROM gbif_vernacular_names WHERE taxon_id = ?
         ORDER BY is_preferred DESC, language ASC`,
      )
      .all(taxonId);
  } catch {
    return [];
  }
}

function getVernacularNamesBatch(taxonIds) {
  const result = {};
  if (taxonIds.length === 0) return result;
  const db = getDb();
  try {
    const placeholders = taxonIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT taxon_id, vernacular_name, language, country_code, is_preferred
         FROM gbif_vernacular_names WHERE taxon_id IN (${placeholders})
         ORDER BY is_preferred DESC, language ASC`,
      )
      .all(...taxonIds);
    for (const row of rows) {
      const list = result[row.taxon_id];
      if (list) list.push(row);
      else result[row.taxon_id] = [row];
    }
    return result;
  } catch {
    return result;
  }
}

function searchBackbone(query, limit = 8) {
  const db = getDb();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cols = selectCols();
  const prefixParam = `${trimmed}%`;
  const substringParam = `%${trimmed}%`;

  let rows;
  try {
    rows = db
      .prepare(
        `SELECT ${cols} FROM gbif_taxa
         WHERE taxon_rank IN ('species', 'subspecies', 'variety', 'form')
           AND (LOWER(canonical_name) LIKE LOWER(?) OR LOWER(canonical_name) LIKE LOWER(?))
         ORDER BY
           CASE WHEN LOWER(canonical_name) LIKE LOWER(?) THEN 0 ELSE 1 END,
           taxonomic_status = 'accepted' DESC,
           LENGTH(canonical_name) ASC
         LIMIT ?`,
      )
      .all(prefixParam, substringParam, prefixParam, limit);
  } catch {
    return [];
  }

  const vernacularByTaxonId = new Map();
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
        .all(...ids);
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

// Mirrors the inline query in app/src/app/api/taxonomy/resolve-batch/route.ts.
function resolveBatchTaxa(speciesKeys, includeVernacularNames) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(gbif_taxa)").all().map((r) => r.name);
  const optionalCols = ["name_according_to", "name_published_in", "name_published_in_year", "parent_taxon_id"].filter(
    (c) => cols.includes(c),
  );
  const selectColsList = ["taxon_id", "scientific_name", "canonical_name", "family", "vernacular_name", ...optionalCols].join(", ");
  const placeholders = speciesKeys.map(() => "?").join(",");
  const rows = db.prepare(`SELECT ${selectColsList} FROM gbif_taxa WHERE taxon_id IN (${placeholders})`).all(...speciesKeys);

  if (includeVernacularNames) {
    const taxonIds = rows.map((row) => row.taxon_id);
    const vernacularByTaxon = getVernacularNamesBatch(taxonIds);
    for (const row of rows) {
      row.vernacular_names = vernacularByTaxon[row.taxon_id] ?? [];
    }
  }

  return rows;
}

module.exports = {
  lookupBackbone,
  lookupBackboneBatch,
  lookupBackboneExhaustive,
  lookupByVernacularName,
  normalizeVernacularName,
  getSubspecies,
  getVernacularNames,
  getVernacularNamesBatch,
  searchBackbone,
  resolveBatchTaxa,
};
