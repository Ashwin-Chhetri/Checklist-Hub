import type { Species, SpeciesEvidenceSource } from "@/types/species.types";

export interface DatasetSummary {
  total: number;
  families: number;
  genera: number;
  orders: number;
}

export function buildDatasetSummary(species: Species[]): DatasetSummary {
  return {
    total: species.length,
    families: new Set(species.map((s) => s.family).filter(Boolean)).size,
    genera: new Set(species.map((s) => s.genus).filter(Boolean)).size,
    orders: new Set(species.map((s) => s.order).filter(Boolean)).size,
  };
}

export interface TaxonomicTreeOrder {
  name: string;
  speciesCount: number;
}

export interface TaxonomicTreeClass {
  name: string;
  orders: TaxonomicTreeOrder[];
}

export interface TaxonomicTreePhylum {
  name: string;
  classes: TaxonomicTreeClass[];
}

export interface TaxonomicTreeKingdom {
  name: string;
  phyla: TaxonomicTreePhylum[];
}

/** Groups accepted species into a Kingdom -> Phylum -> Class -> Order tree with per-order species counts, for the Classification Breakdown section. */
export function buildTaxonomicTree(species: Species[]): TaxonomicTreeKingdom[] {
  const kingdoms = new Map<string, Map<string, Map<string, Map<string, number>>>>();

  for (const s of species) {
    const kingdom = s.kingdom ?? "Unclassified";
    const phylum = s.phylum ?? "Unclassified";
    const klass = s.class ?? "Unclassified";
    const order = s.order ?? "Unclassified";

    if (!kingdoms.has(kingdom)) kingdoms.set(kingdom, new Map());
    const phyla = kingdoms.get(kingdom)!;

    if (!phyla.has(phylum)) phyla.set(phylum, new Map());
    const classes = phyla.get(phylum)!;

    if (!classes.has(klass)) classes.set(klass, new Map());
    const orders = classes.get(klass)!;

    orders.set(order, (orders.get(order) ?? 0) + 1);
  }

  return Array.from(kingdoms.entries()).map(([kingdomName, phyla]) => ({
    name: kingdomName,
    phyla: Array.from(phyla.entries()).map(([phylumName, classes]) => ({
      name: phylumName,
      classes: Array.from(classes.entries()).map(([className, orders]) => ({
        name: className,
        orders: Array.from(orders.entries())
          .map(([orderName, speciesCount]) => ({ name: orderName, speciesCount }))
          .sort((a, b) => b.speciesCount - a.speciesCount),
      })),
    })),
  }));
}

export const SOURCE_LABELS: Record<SpeciesEvidenceSource["source"], string> = {
  gbif: "GBIF",
  ebird: "eBird",
  inaturalist: "iNaturalist",
  literature: "Literature",
  legacy: "Other Records",
};

/** "Month D, YYYY" — the form every platform's own recommended-citation example uses for the access date. */
function formatAccessDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Builds a real, source-appropriate citation string for one evidence
 * source — verified against each platform's own citation guidance, not
 * guessed:
 *
 * - **Literature**: cite the source's own `reference_text` (the actual
 *   bibliographic citation) plus its DOI as a resolvable link, per normal
 *   scholarly citation practice.
 * - **GBIF**: GBIF's own guidance (gbif.org/citation-guidelines) is to cite
 *   either an occurrence-download DOI, or the specific record/species page.
 *   This app queries live GBIF occurrence counts, not bulk downloads, so
 *   there's no download DOI to cite — the species page
 *   (gbif.org/species/<taxonKey>), built from the species' own
 *   `gbifTaxonKey`, is the correct citable thing.
 * - **eBird**: eBird's "recommended_citation.txt" wording only applies to
 *   bulk EOD dataset downloads. This app calls the live eBird REST API
 *   directly (see `ebirdEvidence.ts`), so eBird's own *general* citation
 *   format applies instead (science.ebird.org/use-ebird-data/citation).
 * - **iNaturalist**: iNaturalist's guidance (help.inaturalist.org) is to
 *   cite the specific observation URL with an access date when one is
 *   known, falling back to the general "iNaturalist.org" citation
 *   otherwise — this app doesn't persist a per-species iNat record link
 *   today, so only a manually-attached `source_link` lets a record-level
 *   citation be built; otherwise it falls back to the general form.
 *
 * `accessDate` should be when the package was generated — none of these
 * are static citations, since the underlying live queries can return
 * different results on a later date.
 */
export function citationFor(
  source: SpeciesEvidenceSource,
  gbifTaxonKey: number | null,
  accessDate: Date,
): string {
  const accessed = formatAccessDate(accessDate);
  const doiLink = source.doi ? `https://doi.org/${source.doi}` : null;

  if (source.source === "literature") {
    return [source.reference_text, doiLink].filter(Boolean).join(" ") || SOURCE_LABELS.literature;
  }

  if (source.source === "gbif") {
    const link = source.source_link ?? (gbifTaxonKey != null ? `https://www.gbif.org/species/${gbifTaxonKey}` : null);
    return doiLink
      ? `GBIF Occurrence Download ${doiLink} accessed via GBIF.org on ${accessed}`
      : link
        ? `GBIF.org. ${link}. Accessed via GBIF.org on ${accessed}.`
        : "GBIF.org.";
  }

  if (source.source === "ebird") {
    const link = doiLink ?? source.source_link;
    return `eBird. ${accessDate.getFullYear()}. eBird: An online database of bird distribution and abundance [web application]. eBird, Cornell Lab of Ornithology, Ithaca, New York.${link ? ` ${link}.` : " Available: https://www.ebird.org."} (Accessed: ${accessed}).`;
  }

  if (source.source === "inaturalist") {
    const link = doiLink ?? source.source_link;
    return link
      ? `iNaturalist community. iNaturalist observation: ${link}. Accessed on ${accessed}.`
      : `iNaturalist.org. Available from https://www.inaturalist.org. Accessed on ${accessed}.`;
  }

  return [SOURCE_LABELS[source.source], doiLink ?? source.source_link].filter(Boolean).join(" ");
}

export interface SourceSummaryRow {
  source: SpeciesEvidenceSource["source"];
  label: string;
  recordCount: number;
}

/** Sums evidence-source record counts across accepted species, grouped by the real source types tracked in `species.evidence.sources` — no fabricated categories. */
export function buildSourceSummary(species: Species[]): SourceSummaryRow[] {
  const totals = new Map<SpeciesEvidenceSource["source"], number>();

  for (const s of species) {
    for (const source of s.evidence?.sources ?? []) {
      if (source.status === "discarded") continue;
      totals.set(source.source, (totals.get(source.source) ?? 0) + (source.record_count ?? 0));
    }
  }

  return (Object.keys(SOURCE_LABELS) as SpeciesEvidenceSource["source"][])
    .map((source) => ({ source, label: SOURCE_LABELS[source], recordCount: totals.get(source) ?? 0 }))
    .filter((row) => row.recordCount > 0);
}

function yearFromDateString(value: string | undefined): number | null {
  if (!value) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

/** Every plausible record year for a species — `first_record_year` is often left unset at import, so this also falls back to the import event date and each evidence source's latest observation date rather than leaving the range empty. */
function speciesYears(s: Species): number[] {
  const years: number[] = [];
  if (s.first_record_year != null) years.push(s.first_record_year);
  const eventYear = yearFromDateString(s.identity?.event_date);
  if (eventYear != null) years.push(eventYear);
  for (const source of s.evidence?.sources ?? []) {
    const sourceYear = yearFromDateString(source.latest_observation_date);
    if (sourceYear != null) years.push(sourceYear);
  }
  return years;
}

/** Earliest/latest record year across accepted species, for seeding Temporal Coverage. */
export function temporalRange(species: Species[]): { earliest: number | null; latest: number | null } {
  const years = species.flatMap(speciesYears);
  if (years.length === 0) return { earliest: null, latest: null };
  return { earliest: Math.min(...years), latest: Math.max(...years) };
}

export interface TemporalRecordProvenance {
  year: number;
  speciesName: string;
  sourceLabel: string;
}

/** Same plausible-year sources as speciesYears, but keeping which species/source each year came from, for the Temporal Coverage hover detail. */
function speciesTemporalRecords(s: Species): TemporalRecordProvenance[] {
  const speciesName = s.scientific_name ?? "Unknown species";
  const records: TemporalRecordProvenance[] = [];
  if (s.first_record_year != null) {
    records.push({ year: s.first_record_year, speciesName, sourceLabel: "Import record" });
  }
  const eventYear = yearFromDateString(s.identity?.event_date);
  if (eventYear != null) {
    records.push({ year: eventYear, speciesName, sourceLabel: "Import record" });
  }
  for (const source of s.evidence?.sources ?? []) {
    const sourceYear = yearFromDateString(source.latest_observation_date);
    if (sourceYear != null) {
      records.push({ year: sourceYear, speciesName, sourceLabel: SOURCE_LABELS[source.source] });
    }
  }
  return records;
}

export interface TemporalCoverage {
  earliest: TemporalRecordProvenance | null;
  latest: TemporalRecordProvenance | null;
}

/** Like temporalRange, but keeps which species/source produced the earliest and latest year, so the UI can show "1998 — via GBIF on Panthera tigris" on hover instead of a bare number. */
export function temporalCoverage(species: Species[]): TemporalCoverage {
  const records = species.flatMap(speciesTemporalRecords);
  if (records.length === 0) return { earliest: null, latest: null };

  let earliest = records[0];
  let latest = records[0];
  for (const record of records) {
    if (record.year < earliest.year) earliest = record;
    if (record.year > latest.year) latest = record;
  }
  return { earliest, latest };
}
