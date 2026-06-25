import { lookupBackboneExhaustive } from "@/lib/taxonomy/backbone.server";

interface RankValues {
  kingdom?: string | null;
  phylum?: string | null;
  class?: string | null;
  order?: string | null;
  family?: string | null;
  genus?: string | null;
  species?: string | null;
}

interface SynonymOrConflictEntry {
  name?: string;
  suggested_name?: string;
  event_type?: string;
  authority?: string;
  authorship?: string;
  taxon_id?: number | null;
  year?: number | null;
  classification?: RankValues | null;
}

export interface EnrichableSpecies {
  scientific_name: string;
  common_name: string | null;
  gbif_taxon_key: number | null;
  identity?: { imported_scientific_name?: string; imported_common_name?: string } | null;
  taxonomy?: {
    current_name?: string;
    accepted_name?: string;
    classification?: RankValues | null;
    authorship?: string;
    name_published_in_year?: number;
    synonyms?: SynonymOrConflictEntry[];
    authority_conflicts?: SynonymOrConflictEntry[];
    [key: string]: unknown;
  } | null;
}

function isEmptyClassification(c?: RankValues | null): boolean {
  if (!c) return true;
  return !c.kingdom && !c.phylum && !c.class && !c.order && !c.family && !c.genus && !c.species;
}

/**
 * Last-resort, on-demand repair for a single species row whose taxonomy
 * hierarchy/authority/year is still incomplete after ingestion (every
 * ingestion-time pass tries cheaper/narrower lookups first — see
 * buildSpeciesPayload.server.ts's Pass 7 for the same strategy applied in
 * bulk at import time). Gathers every identifying string available for the
 * row — its own/accepted scientific name, the originally imported name, any
 * recorded synonym/conflict names, and every known common name — and tries
 * them all via `lookupBackboneExhaustive` until one resolves real hierarchy
 * data.
 *
 * Pure function: returns the (possibly unchanged) taxonomy object plus
 * whether anything changed. Callers persist the result themselves — this
 * fetcher is meant to run ONCE per gap and have its result written back, not
 * be re-run on every render.
 */
export function enrichSpeciesTaxonomy(
  species: EnrichableSpecies,
  kingdomHint?: string,
): { taxonomy: NonNullable<EnrichableSpecies["taxonomy"]>; changed: boolean } {
  const taxonomy = { ...(species.taxonomy ?? {}) } as NonNullable<EnrichableSpecies["taxonomy"]>;
  let changed = false;

  const commonNames = [species.common_name, species.identity?.imported_common_name];

  const hasOpenConflicts = (taxonomy.authority_conflicts?.length ?? 0) > 0;
  const rowNeedsEnrichment =
    isEmptyClassification(taxonomy.classification) || !taxonomy.authorship || taxonomy.name_published_in_year == null;
  // A row with open conflicts and no confirmed identity yet has that identity
  // DELIBERATELY left unresolved pending user review (see buildSpeciesPayload
  // .server.ts Pass 5/7) — never use a conflict option's suggested_name (a
  // DIFFERENT row's identity, or common-name-only evidence) as a candidate for
  // resolving THIS row's own classification, or this fetcher would silently
  // adopt it and make the row's own tab show identical data to the conflict
  // option's tab, the same contamination ingestion now deliberately avoids.
  if (rowNeedsEnrichment && !(hasOpenConflicts && !species.gbif_taxon_key)) {
    const names = [
      taxonomy.current_name,
      taxonomy.accepted_name,
      species.scientific_name,
      species.identity?.imported_scientific_name,
      ...(taxonomy.synonyms ?? []).map((s) => s.name),
    ];
    const found = lookupBackboneExhaustive({
      gbifKey: species.gbif_taxon_key ?? undefined,
      names,
      commonNames,
      kingdomHint,
    });
    if (found.matchType !== "none") {
      if (isEmptyClassification(taxonomy.classification) && !isEmptyClassification(found.classification)) {
        taxonomy.classification = found.classification;
        changed = true;
      }
      if (!taxonomy.authorship && found.authorship) {
        taxonomy.authorship = found.authorship;
        changed = true;
      }
      if (taxonomy.name_published_in_year == null && found.namePublishedInYear != null) {
        taxonomy.name_published_in_year = found.namePublishedInYear;
        changed = true;
      }
    }
  }

  const enrichEntries = (entries: SynonymOrConflictEntry[] | undefined, nameField: "name" | "suggested_name") => {
    if (!entries?.length) return entries;
    return entries.map((entry) => {
      const complete = !isEmptyClassification(entry.classification) && entry.year != null;
      if (complete) return entry;

      // Conflict entries deliberately skip the commonNames fallback: a
      // conflict's `suggested_name` is a candidate identity DIFFERENT from
      // this row's own, and falling back to the row's common name would
      // resolve via the same weak convergence that flagged the conflict in
      // the first place — risking attributing a DIFFERENT option's taxon to
      // this one.
      const found = lookupBackboneExhaustive({
        gbifKey: entry.taxon_id ?? undefined,
        names: [entry[nameField]],
        commonNames: nameField === "name" ? commonNames : undefined,
        kingdomHint,
      });
      if (found.matchType === "none") return entry;

      const next = { ...entry };
      if (isEmptyClassification(entry.classification) && !isEmptyClassification(found.ownClassification)) {
        next.classification = found.ownClassification;
        changed = true;
      }
      if (!next.taxon_id && found.ownTaxonId) {
        next.taxon_id = found.ownTaxonId;
        changed = true;
      }
      if (!next.year && found.ownNamePublishedInYear) {
        next.year = found.ownNamePublishedInYear;
        changed = true;
      }
      if (nameField === "name") {
        // Synonym entries: `authority` is a real taxonomic authorship for
        // event_type "synonym", but a source/provenance label for
        // "source_synonym" — never overwrite the label.
        if (next.event_type !== "source_synonym" && !next.authority && found.ownAuthorship) {
          next.authority = found.ownAuthorship;
          changed = true;
        }
      } else {
        // Conflict entries: `authority` is always a source label; the real
        // taxonomic authorship lives in `authorship`.
        if (!next.authorship && found.ownAuthorship) {
          next.authorship = found.ownAuthorship;
          changed = true;
        }
      }
      return next;
    });
  };

  taxonomy.synonyms = enrichEntries(taxonomy.synonyms, "name");
  taxonomy.authority_conflicts = enrichEntries(taxonomy.authority_conflicts, "suggested_name");

  return { taxonomy, changed };
}
