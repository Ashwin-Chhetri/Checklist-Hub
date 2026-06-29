import type { CreateChecklistSpeciesInput } from "@/types/checklist.types";
import {
  lookupBackbone,
  lookupBackboneBatch,
  lookupBackboneExhaustive,
  lookupByVernacularName,
  normalizeVernacularName,
} from "@/lib/taxonomy/backbone.server";
import { resolveViaGbifLiveBatch } from "@/lib/taxonomy/gbif-live.server";

type RankKey = "kingdom" | "phylum" | "class" | "order" | "family" | "genus" | "species";
const RANKS: RankKey[] = ["kingdom", "phylum", "class", "order", "family", "genus", "species"];
type Classification = Partial<Record<RankKey, string | null | undefined>> | null | undefined;

/** True when a classification object is absent or every rank on it is null/empty —
 * e.g. the all-null placeholder evidence-discovery attaches before backbone
 * enrichment runs. A plain truthiness check on the object itself (`!c`) misses
 * this, since the placeholder object itself is truthy even though it carries no
 * real data — that gap previously made later passes skip overwriting it with the
 * real backbone-derived hierarchy. */
function isEmptyClassification(c: Classification): boolean {
  if (!c) return true;
  return !Object.values(c).some((v) => Boolean(v));
}

/** Merges a freshly-resolved backbone classification onto whatever the row
 * already had, preferring the backbone value per-rank but keeping any
 * already-known rank the backbone didn't return (rare, but cheap to keep). */
function mergeClassification(existing: Classification, incoming: Classification): Record<RankKey, string | null> {
  const merged = {} as Record<RankKey, string | null>;
  for (const rank of RANKS) {
    merged[rank] = incoming?.[rank] ?? existing?.[rank] ?? null;
  }
  return merged;
}

/**
 * Normalizes a raw species batch against the GBIF backbone (synonym/doubtful
 * detection, live re-check, vernacular-name fallback, within-batch common-name
 * cross-reference) and shapes the final per-row payload the
 * create_checklist_with_species / add_species_to_checklist RPCs expect.
 *
 * Mutates the input array's items in place while normalizing (same approach
 * used before this was extracted from the checklist-creation route), then
 * returns the final mapped payload — does not deduplicate or insert anything.
 */
export async function buildSpeciesPayload(rawSpecies: CreateChecklistSpeciesInput[], kingdomHint?: string) {
  // ─── Pass 1: Normalize species that have no GBIF key ────────────────────────
  // Detects synonyms and outdated names via backbone (taxonomicStatus + acceptedNameUsageID).
  // Never rewrites scientific_name — original name is preserved in identity + taxonomy JSONB.
  const needsNorm = rawSpecies.filter((s) => !s.gbif_taxon_key);
  if (needsNorm.length > 0) {
    const normResults = await lookupBackboneBatch(
      needsNorm.map((s) => ({ id: s.scientific_name, name: s.scientific_name })),
      kingdomHint,
    );
    for (const s of needsNorm as CreateChecklistSpeciesInput[]) {
      const norm = normResults.get(s.scientific_name);
      if (!norm || norm.matchType === "none") {
        // No backbone match → will be marked unresolved below.
        continue;
      }

      s.gbif_taxon_key = norm.taxonKey;
      s.canonical_name = norm.canonicalName ?? undefined;
      if (!isEmptyClassification(norm.classification)) {
        s.classification = mergeClassification(s.classification, norm.classification);
      }
      // Authority/year of the resolved accepted taxon — captured for EVERY match
      // type (including plain "accepted") so the row never needs a live backbone
      // re-lookup just to display its own name's authority/year.
      if (!s.current_authorship && norm.authorship) s.current_authorship = norm.authorship;
      if (s.current_name_published_in_year == null && norm.namePublishedInYear != null) {
        s.current_name_published_in_year = norm.namePublishedInYear;
      }

      if (norm.matchType === "synonym") {
        const originalName = s.scientific_name;
        const importedFull = norm.ownScientificName;
        const importedAuthority =
          importedFull && originalName && importedFull.startsWith(originalName)
            ? importedFull.slice(originalName.length).trim() || undefined
            : undefined;

        s.scientific_name_authorship = importedAuthority;
        s.canonical_name = norm.canonicalName ?? undefined;
        if (!s.gbif_taxon_key) s.gbif_taxon_key = norm.taxonKey;
        if (!isEmptyClassification(norm.classification)) {
          s.classification = mergeClassification(s.classification, norm.classification);
        }

        s.revisions = [
          ...(s.revisions ?? []),
          {
            taxonKey: norm.ownTaxonId,
            scientificName: originalName,
            status: "synonym",
            occurrenceCounts: s.occurrence_count ? { legacy: s.occurrence_count } : {},
          },
        ];

        s.taxonomy_synonyms = [
          ...(s.taxonomy_synonyms ?? []),
          {
            event_type: "synonym",
            name: originalName,
            authority: norm.ownAuthorship ?? undefined,
            // The synonym's OWN published year, not the accepted taxon's.
            year: norm.ownNamePublishedInYear ?? undefined,
            taxon_id: norm.ownTaxonId ?? undefined,
            // The synonym's OWN hierarchy (genus/species can differ from the
            // accepted taxon's) — not `norm.classification`, which is the
            // accepted taxon's.
            classification: norm.ownClassification,
          },
        ];

        if (!norm.canonicalName) {
          s.taxonomy_conflicts = [
            ...(s.taxonomy_conflicts ?? []),
            {
              authority: "GBIF Backbone",
              suggested_name: originalName,
              status: "found",
              notes: "This name is recorded as a GBIF synonym but the accepted name could not be resolved from the local backbone.",
              taxon_id: norm.ownTaxonId,
              // suggested_name here IS the original/own name, so its hierarchy
              // and year are the matched taxon's own, not the (unresolvable) accepted one.
              classification: norm.ownClassification,
              year: norm.ownNamePublishedInYear,
              authorship: norm.ownAuthorship,
            },
          ];
        }
      } else if (norm.matchType === "doubtful") {
        const doubtfulName = norm.canonicalName ?? norm.scientificName ?? s.scientific_name;
        const authorityNote = norm.authorship ? ` (${norm.authorship})` : "";
        s.taxonomy_conflicts = [
          ...(s.taxonomy_conflicts ?? []),
          {
            authority: "GBIF Backbone",
            suggested_name: doubtfulName,
            status: "found",
            notes: `Taxonomic status is doubtful in the GBIF backbone${authorityNote}.`,
            taxon_id: norm.taxonKey,
            classification: norm.classification,
            year: norm.namePublishedInYear,
            authorship: norm.authorship,
          },
        ];
      }
    }
  }

  // ─── Pass 2: Check species that already have a GBIF key ─────────────────────
  // Catches stale/synonym keys from discovery or pre-filled CSV columns.
  const hasKeyNeedsCheck = (rawSpecies as CreateChecklistSpeciesInput[]).filter(
    (s) => s.gbif_taxon_key && !(s.taxonomy_synonyms?.length),
  );
  if (hasKeyNeedsCheck.length > 0) {
    const keyResults = await lookupBackboneBatch(
      hasKeyNeedsCheck.map((s) => ({ id: String(s.gbif_taxon_key), gbifKey: s.gbif_taxon_key! })),
      kingdomHint,
    );
    for (const s of hasKeyNeedsCheck) {
      const norm = keyResults.get(String(s.gbif_taxon_key));
      if (!norm) continue;

      if (!s.current_authorship && norm.authorship) s.current_authorship = norm.authorship;
      if (s.current_name_published_in_year == null && norm.namePublishedInYear != null) {
        s.current_name_published_in_year = norm.namePublishedInYear;
      }
      if (!isEmptyClassification(norm.classification)) {
        s.classification = mergeClassification(s.classification, norm.classification);
      }

      if (norm.matchType !== "synonym" && norm.matchType !== "doubtful") continue;

      if (norm.matchType === "synonym") {
        const originalName = s.scientific_name;
        const importedFull = norm.ownScientificName;
        const importedAuthority =
          importedFull && originalName && importedFull.startsWith(originalName)
            ? importedFull.slice(originalName.length).trim() || undefined
            : undefined;

        s.scientific_name_authorship = importedAuthority;
        s.gbif_taxon_key = norm.taxonKey;
        s.canonical_name = norm.canonicalName ?? undefined;
        if (!isEmptyClassification(norm.classification)) {
          s.classification = mergeClassification(s.classification, norm.classification);
        }

        s.revisions = [
          ...(s.revisions ?? []),
          {
            taxonKey: norm.ownTaxonId,
            scientificName: originalName,
            status: "synonym",
            occurrenceCounts: s.occurrence_count ? { legacy: s.occurrence_count } : {},
          },
        ];
        s.taxonomy_synonyms = [
          ...(s.taxonomy_synonyms ?? []),
          {
            event_type: "synonym",
            name: originalName,
            authority: norm.ownAuthorship ?? undefined,
            year: norm.ownNamePublishedInYear ?? undefined,
            taxon_id: norm.ownTaxonId ?? undefined,
            classification: norm.ownClassification,
          },
        ];

        if (!norm.canonicalName) {
          s.taxonomy_conflicts = [
            ...(s.taxonomy_conflicts ?? []),
            {
              authority: "GBIF Backbone",
              suggested_name: originalName,
              status: "found",
              notes: "This name is recorded as a GBIF synonym but the accepted name could not be resolved from the local backbone.",
              taxon_id: norm.ownTaxonId,
              classification: norm.ownClassification,
              year: norm.ownNamePublishedInYear,
              authorship: norm.ownAuthorship,
            },
          ];
        }
      } else {
        const doubtfulName = norm.canonicalName ?? norm.scientificName ?? s.scientific_name;
        const authorityNote = norm.authorship ? ` (${norm.authorship})` : "";
        s.taxonomy_conflicts = [
          ...(s.taxonomy_conflicts ?? []),
          {
            authority: "GBIF Backbone",
            suggested_name: doubtfulName,
            status: "found",
            notes: `Taxonomic status is doubtful in the GBIF backbone${authorityNote}.`,
            taxon_id: norm.taxonKey,
            classification: norm.classification,
            year: norm.namePublishedInYear,
            authorship: norm.authorship,
          },
        ];
      }
    }
  }

  // ─── Pass 3: Live GBIF API check for accepted-but-reclassified names ─────────
  // Capped at 50 to respect GBIF's anonymous rate limit (~60 req/min).
  const liveCheckCandidates = (rawSpecies as CreateChecklistSpeciesInput[])
    .filter((s) => !s.taxonomy_synonyms?.length && !s.taxonomy_conflicts?.length)
    .slice(0, 50);

  if (liveCheckCandidates.length > 0) {
    const liveResults = await resolveViaGbifLiveBatch(liveCheckCandidates.map((s) => s.scientific_name));
    for (const s of liveCheckCandidates) {
      const live = liveResults.get(s.scientific_name);
      if (!live || live.status === "unresolved") continue;

      // No name_published_in_year available from the live match/species endpoints —
      // only authorship is captured here for accepted-via-live-API rows.
      if (!s.current_authorship && live.authorship) s.current_authorship = live.authorship;

      if (live.status === "accepted") continue;

      const originalName = s.scientific_name;

      // The live GBIF API never returns taxonomic hierarchy, but the resolved
      // accepted name often DOES exist locally under its own (accepted) row —
      // double-check the local backbone by name so hierarchy isn't left empty
      // just because the original spelling wasn't found locally.
      const localForLive = live.canonicalName ? await lookupBackbone({ name: live.canonicalName }) : null;
      const liveClassification =
        localForLive && !isEmptyClassification(localForLive.classification)
          ? localForLive.classification
          : undefined;
      const liveYear = localForLive?.namePublishedInYear ?? undefined;

      if (live.status === "synonym" && live.canonicalName && live.canonicalName !== originalName) {
        s.canonical_name = live.canonicalName;
        if (!s.gbif_taxon_key && live.usageKey) s.gbif_taxon_key = live.usageKey;
        if (liveClassification) s.classification = mergeClassification(s.classification, liveClassification);

        s.taxonomy_synonyms = [
          ...(s.taxonomy_synonyms ?? []),
          {
            event_type: "synonym",
            name: originalName,
            authority: live.authorship ?? undefined,
            taxon_id: live.usageKey ?? undefined,
            classification: liveClassification,
            year: liveYear,
          },
        ];
        s.revisions = [
          ...(s.revisions ?? []),
          {
            taxonKey: s.gbif_taxon_key ?? null,
            scientificName: originalName,
            status: "synonym",
            occurrenceCounts: s.occurrence_count ? { legacy: s.occurrence_count } : {},
          },
        ];
      } else if (live.status === "doubtful") {
        const authorityNote = live.authorship ? ` (${live.authorship})` : "";
        s.taxonomy_conflicts = [
          ...(s.taxonomy_conflicts ?? []),
          {
            authority: "GBIF Live API",
            suggested_name: live.canonicalName ?? originalName,
            status: "found",
            notes: `Taxonomic status is doubtful in the current GBIF backbone${authorityNote}.`,
            taxon_id: live.usageKey,
            authorship: live.authorship,
            classification: liveClassification,
            year: liveYear,
          },
        ];
      }
    }
  }

  // ─── Pass 4: Vernacular-name fuzzy lookup for still-unresolved rows ─────────
  // Rescues rows like "Eastern Cattle-Egret" that don't match the backbone by
  // scientific name but whose common name unambiguously maps to one backbone taxon.
  const unresolvedWithCommonName = (rawSpecies as CreateChecklistSpeciesInput[]).filter(
    (s) => !s.gbif_taxon_key && s.common_name?.trim(),
  );
  for (const s of unresolvedWithCommonName) {
    const norm = await lookupByVernacularName(s.common_name!);
    if (!norm || norm.matchType === "none") continue;

    s.gbif_taxon_key = norm.taxonKey;
    s.canonical_name = norm.canonicalName ?? undefined;
    if (!isEmptyClassification(norm.classification)) {
      s.classification = mergeClassification(s.classification, norm.classification);
    }
    if (!s.current_authorship && norm.authorship) s.current_authorship = norm.authorship;
    if (s.current_name_published_in_year == null && norm.namePublishedInYear != null) {
      s.current_name_published_in_year = norm.namePublishedInYear;
    }

    if (norm.matchType === "synonym") {
      s.taxonomy_synonyms = [
        ...(s.taxonomy_synonyms ?? []),
        {
          event_type: "synonym",
          name: s.scientific_name,
          authority: norm.ownAuthorship ?? undefined,
          // The synonym's OWN published year/hierarchy, not the accepted taxon's.
          year: norm.ownNamePublishedInYear ?? undefined,
          taxon_id: norm.ownTaxonId ?? undefined,
          classification: norm.ownClassification,
        },
      ];
      if (!norm.canonicalName) {
        s.taxonomy_conflicts = [
          ...(s.taxonomy_conflicts ?? []),
          {
            authority: "GBIF Backbone (vernacular match)",
            suggested_name: s.scientific_name,
            status: "found",
            notes: "Matched via common name; accepted name unresolvable from local backbone.",
            taxon_id: norm.ownTaxonId,
            classification: norm.ownClassification,
            year: norm.ownNamePublishedInYear,
            authorship: norm.ownAuthorship,
          },
        ];
      }
    }
  }

  // ─── Pass 5: Within-batch common-name cross-reference ────────────────────────
  // For rows still unresolved after Passes 1–4, check whether any resolved row in
  // the SAME batch shares a normalized common name. If so, adopt the resolved row's
  // gbif_taxon_key and flag as authority_conflict so the workbench surfaces both
  // rows as a naming dispute requiring user review. Never auto-merges.
  const resolvedByCommonName = new Map<
    string,
    {
      gbif_taxon_key: number;
      canonical_name?: string;
      classification?: Record<string, string | null>;
      authorship?: string;
      year?: number;
    }
  >();
  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    if (!s.gbif_taxon_key || !s.common_name?.trim()) continue;
    const key = normalizeVernacularName(s.common_name);
    if (key && !resolvedByCommonName.has(key)) {
      resolvedByCommonName.set(key, {
        gbif_taxon_key: s.gbif_taxon_key,
        canonical_name: s.canonical_name,
        classification: s.classification as Record<string, string | null> | undefined,
        authorship: s.current_authorship,
        year: s.current_name_published_in_year,
      });
    }
  }

  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    if (s.gbif_taxon_key || !s.common_name?.trim()) continue;
    const key = normalizeVernacularName(s.common_name);
    const match = key ? resolvedByCommonName.get(key) : undefined;
    if (!match) continue;

    // Deliberately NOT adopting match.gbif_taxon_key/canonical_name/classification
    // onto this row — a shared COMMON name is weak evidence (unlike Pass 6's exact
    // scientific-name match) that this row's own scientific name really IS that
    // taxon. Doing so previously made the row's own "current name" classification
    // silently become a copy of the OTHER option's hierarchy, so both tabs in the
    // workbench showed identical data even though this row's own name was never
    // verified. Only record the other option as a conflict for the user to decide;
    // this row's own identity stays unresolved until they pick an option.
    s.taxonomy_conflicts = [
      ...(s.taxonomy_conflicts ?? []),
      {
        authority: "Common Name Match (within batch)",
        suggested_name: match.canonical_name ?? s.scientific_name,
        status: "found",
        notes: `"${s.scientific_name}" could not be resolved in the backbone, but its common name matches a resolved row in this checklist. Different scientific names for the same common name — review and merge if appropriate.`,
        taxon_id: match.gbif_taxon_key,
        classification: match.classification,
        authorship: match.authorship,
        year: match.year,
      },
    ];
  }

  // ─── Pass 6: Within-batch scientific-name synonym cross-reference ───────────
  // Common-name matching (Pass 5) misses cases where two rows for the same taxon
  // have different/missing common names. This pass catches them by scientific
  // name instead: for rows still unresolved, check whether the row's own
  // scientific_name literally matches another resolved row's current name OR one
  // of that row's own recorded historical synonym names (taxonomy_synonyms,
  // populated by Passes 1–4 from genuine backbone synonym resolution). A literal
  // match there means this row's name really is a synonym of that resolved row's
  // accepted taxon — so, unlike Pass 5, this resolves cleanly as a synonym rather
  // than an authority_conflict requiring review.
  const normalizeScientificName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
  type ScientificNameMatch = {
    gbif_taxon_key: number;
    canonical_name?: string;
    classification?: Classification;
    authorship?: string;
    year?: number;
  };
  const resolvedByScientificName = new Map<string, ScientificNameMatch>();
  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    if (!s.gbif_taxon_key) continue;
    // The row's own (current/accepted) name maps to its own classification/authorship.
    const ownEntry: ScientificNameMatch = {
      gbif_taxon_key: s.gbif_taxon_key,
      canonical_name: s.canonical_name,
      classification: s.classification,
      authorship: s.current_authorship,
      year: s.current_name_published_in_year,
    };
    const ownKey = normalizeScientificName(s.scientific_name);
    if (ownKey && !resolvedByScientificName.has(ownKey)) {
      resolvedByScientificName.set(ownKey, ownEntry);
    }
    // Each of the row's own recorded synonym names maps to THAT synonym's own
    // classification/authorship/year (not the accepted row's) — they can differ.
    for (const syn of s.taxonomy_synonyms ?? []) {
      const synKey = normalizeScientificName(syn.name);
      if (synKey && !resolvedByScientificName.has(synKey)) {
        resolvedByScientificName.set(synKey, {
          gbif_taxon_key: syn.taxon_id ?? s.gbif_taxon_key,
          canonical_name: s.canonical_name,
          classification: syn.classification ?? ownEntry.classification,
          authorship: syn.authority,
          year: syn.year,
        });
      }
    }
  }

  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    if (s.gbif_taxon_key) continue;
    const key = normalizeScientificName(s.scientific_name);
    const match = resolvedByScientificName.get(key);
    if (!match) continue;

    const originalName = s.scientific_name;
    s.gbif_taxon_key = match.gbif_taxon_key;
    s.canonical_name = match.canonical_name;
    if (!isEmptyClassification(match.classification)) {
      s.classification = mergeClassification(s.classification, match.classification);
    }

    s.taxonomy_synonyms = [
      ...(s.taxonomy_synonyms ?? []),
      {
        event_type: "synonym",
        name: originalName,
        authority: match.authorship ?? "Within-batch scientific name match",
        year: match.year,
        taxon_id: match.gbif_taxon_key,
        classification: match.classification,
      },
    ];
  }

  // ─── Cross-source synonym flagging ───────────────────────────────────────────
  // When evidence providers (iNat/eBird) reported a synonym name, sourceSynonyms
  // is populated on the incoming species object. Inject taxonomy_synonyms entries
  // so the workbench surfaces the fact that a source used an outdated name.
  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    const sourceSynonyms = (s as { sourceSynonyms?: Array<{ source: string; synonymName: string; acceptedName: string }> })
      .sourceSynonyms;
    if (!sourceSynonyms?.length) continue;
    for (const ss of sourceSynonyms) {
      // `ss.synonymName` is a real scientific name reported by another source —
      // look it up directly so its own hierarchy/year isn't left empty just
      // because this pass never otherwise queries the backbone.
      const synLookup = await lookupBackbone({ name: ss.synonymName });
      const hasMatch = synLookup.matchType !== "none";
      s.taxonomy_synonyms = [
        ...(s.taxonomy_synonyms ?? []),
        {
          event_type: "source_synonym",
          name: ss.synonymName,
          // Keep `authority` as the source label (existing convention for this
          // event type) rather than overwriting it with a taxonomic authorship.
          authority: ss.source,
          taxon_id: hasMatch ? synLookup.ownTaxonId ?? undefined : undefined,
          year: hasMatch ? synLookup.ownNamePublishedInYear ?? undefined : undefined,
          classification: hasMatch ? synLookup.ownClassification : undefined,
        },
      ];
    }
  }

  // ─── Pass 7: Exhaustive fallback enrichment ──────────────────────────────────
  // Catch-all for anything every earlier pass still left incomplete. Each pass
  // above only tries ONE identifying string per lookup (the row's primary
  // scientific_name, or a single suggested/synonym name, or a single common
  // name) — but a row can have several valid identifiers: its own name, any
  // recorded synonym/basionym names, and several different vernacular names
  // from different sources (e.g. "Medium Egret" vs "Intermediate Egret" for
  // the same taxon). This pass tries ALL of them, in priority order, via
  // `lookupBackboneExhaustive`, for whatever is still missing hierarchy/
  // authority/year. Never overwrites data a cheaper pass already found.
  for (const s of rawSpecies as CreateChecklistSpeciesInput[]) {
    const rowCommonNames = [s.common_name, ...(s.alternate_common_names ?? [])];
    const hasOpenConflicts = (s.taxonomy_conflicts?.length ?? 0) > 0;

    const rowNeedsEnrichment =
      isEmptyClassification(s.classification) || !s.current_authorship || s.current_name_published_in_year == null;
    // A row with open conflicts already (Pass 5) has its identity DELIBERATELY
    // left unresolved pending user review — common-name evidence alone wasn't
    // enough to safely adopt an identity there, so this catch-all pass must not
    // quietly resolve it via the same kind of evidence (vernacular convergence)
    // and overwrite the row's own (still-unresolved) classification with
    // whichever taxon a common name happens to point to. Only rows with NO
    // taxon_id AND NO open conflict are genuinely free to adopt one here.
    if (rowNeedsEnrichment && !(hasOpenConflicts && !s.gbif_taxon_key)) {
      const rowNames = [
        s.canonical_name,
        s.scientific_name,
        ...(s.taxonomy_synonyms ?? []).map((syn) => syn.name),
      ];
      const found = await lookupBackboneExhaustive({
        gbifKey: s.gbif_taxon_key ?? undefined,
        names: rowNames,
        commonNames: rowCommonNames,
        kingdomHint,
      });
      if (found.matchType !== "none") {
        if (!s.gbif_taxon_key) s.gbif_taxon_key = found.taxonKey;
        if (!s.canonical_name) s.canonical_name = found.canonicalName ?? undefined;
        if (isEmptyClassification(s.classification) && !isEmptyClassification(found.classification)) {
          s.classification = mergeClassification(s.classification, found.classification);
        }
        if (!s.current_authorship && found.authorship) s.current_authorship = found.authorship;
        if (s.current_name_published_in_year == null && found.namePublishedInYear != null) {
          s.current_name_published_in_year = found.namePublishedInYear;
        }
      }
    }

    for (const syn of s.taxonomy_synonyms ?? []) {
      if (!isEmptyClassification(syn.classification) && syn.authority && syn.year != null) continue;
      const found = await lookupBackboneExhaustive({
        gbifKey: syn.taxon_id ?? undefined,
        names: [syn.name],
        commonNames: rowCommonNames,
        kingdomHint,
      });
      if (found.matchType === "none") continue;
      if (isEmptyClassification(syn.classification) && !isEmptyClassification(found.ownClassification)) {
        syn.classification = found.ownClassification;
      }
      if (!syn.taxon_id && found.ownTaxonId) syn.taxon_id = found.ownTaxonId;
      if (!syn.year && found.ownNamePublishedInYear) syn.year = found.ownNamePublishedInYear;
      // source_synonym entries keep `authority` as a provenance label — never
      // overwrite it with a taxonomic authorship string.
      if (syn.event_type !== "source_synonym" && !syn.authority && found.ownAuthorship) {
        syn.authority = found.ownAuthorship;
      }
    }

    for (const conflict of s.taxonomy_conflicts ?? []) {
      if (!isEmptyClassification(conflict.classification) && conflict.authorship && conflict.year != null) continue;
      // No commonNames fallback here, unlike the synonym loop above: a conflict
      // entry's `suggested_name` is a candidate identity DIFFERENT from this
      // row's own, specifically because direct evidence (exact name match) was
      // ambiguous or didn't fully agree — falling back to the row's common
      // name would resolve via the same weak convergence Pass 5 already used
      // to flag the conflict, risking giving this option whichever taxon a
      // DIFFERENT option already legitimately owns.
      const found = await lookupBackboneExhaustive({
        gbifKey: conflict.taxon_id ?? undefined,
        names: [conflict.suggested_name],
        kingdomHint,
      });
      if (found.matchType === "none") continue;
      if (isEmptyClassification(conflict.classification) && !isEmptyClassification(found.ownClassification)) {
        conflict.classification = found.ownClassification;
      }
      if (!conflict.taxon_id && found.ownTaxonId) conflict.taxon_id = found.ownTaxonId;
      if (!conflict.year && found.ownNamePublishedInYear) conflict.year = found.ownNamePublishedInYear;
      if (!conflict.authorship && found.ownAuthorship) conflict.authorship = found.ownAuthorship;
    }
  }

  // ─── Build final species payload ─────────────────────────────────────────────
  // Derives taxonomy_status signal per row so the RPC can set it correctly:
  //   unresolved         → no GBIF key found at all
  //   authority_conflict → open taxonomy_conflicts entries
  //   synonym            → taxonomy_synonyms entries present (imported name ≠ accepted)
  //   accepted           → clean backbone match
  //
  // ALL rows are forwarded — including synonym rows that share an accepted_taxon_id
  // with another row. No deduplication here (call sites dedupe against existing
  // checklist species before calling this, where relevant). The workbench
  // "Potential Duplicates" view surfaces groups and the user decides.
  return rawSpecies.map((s) => {
    const importedSciName =
      s.taxonomy_synonyms?.find((syn) => syn.event_type === "synonym")?.name ?? s.scientific_name;

    let taxonomyStatusSignal: string;
    // Conflicts take priority over "unresolved" — a row can have open conflicts
    // (Pass 5: a common-name match to another row's taxon) while its OWN identity
    // is still unset, and that's exactly the case that needs surfacing for
    // review, not silently filing it away as plain "unresolved".
    if (s.taxonomy_conflicts?.length) {
      taxonomyStatusSignal = "authority_conflict";
    } else if (!s.gbif_taxon_key) {
      taxonomyStatusSignal = "unresolved";
    } else if (s.taxonomy_synonyms?.length) {
      taxonomyStatusSignal = "synonym";
    } else {
      taxonomyStatusSignal = "accepted";
    }

    return {
      scientific_name: s.scientific_name,
      common_name: s.common_name ?? null,
      gbif_taxon_key: s.gbif_taxon_key ?? null,
      classification: s.classification ?? null,
      // Pass the derived status so the RPC can set taxonomy_status without re-deriving.
      taxonomy_status: taxonomyStatusSignal,
      identity: {
        imported_scientific_name: importedSciName,
        imported_common_name: s.common_name,
        scientific_name_authorship: s.scientific_name_authorship ?? undefined,
        occurrence_count: s.occurrence_count,
        event_date: s.event_date,
      },
      evidence:
        s.occurrence_count != null || s.sources?.length || (s.revisions?.length ?? 0) > 0
          ? {
              occurrence_count: s.occurrence_count ?? undefined,
              sources: (s.sources ?? []).map((source) => ({
                source,
                record_count: s.occurrence_counts?.[source] ?? undefined,
                source_link: s.source_links?.[source] ?? undefined,
              })),
              external_ids: s.gbif_taxon_key != null ? { gbif: s.gbif_taxon_key } : undefined,
              revisions: s.revisions ?? [],
            }
          : {},
      taxonomy:
        s.gbif_taxon_key != null || (s.taxonomy_conflicts?.length ?? 0) > 0
          ? {
              imported_name: importedSciName,
              current_name: s.canonical_name ?? s.scientific_name,
              accepted_name: s.canonical_name ?? undefined,
              accepted_taxon_id: s.gbif_taxon_key,
              classification: s.classification ?? undefined,
              authorship: s.current_authorship ?? undefined,
              name_published_in_year: s.current_name_published_in_year ?? undefined,
              authority_conflicts: s.taxonomy_conflicts ?? [],
              synonyms: s.taxonomy_synonyms ?? [],
              revisions: s.revisions ?? [],
            }
          : {
              imported_name: s.scientific_name,
              current_name: s.scientific_name,
            },
      evidence_sources: s.evidence_sources ?? [],
      external_db_records: s.external_db_records ?? [],
      publications: s.publications ?? [],
      historical_mentions: s.historical_mentions ?? [],
      taxonomy_conflicts: s.taxonomy_conflicts ?? [],
      taxonomy_synonyms: s.taxonomy_synonyms ?? [],
    };
  });
}
