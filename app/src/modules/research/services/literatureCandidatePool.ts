import type { RawSpeciesRecord, SourceSummary } from "@/modules/evidence/discovery/types";
import type { DeepSearchResults } from "./deepSearchService";

const MIN_PLAUSIBLE_YEAR = 1700;

function plausibleYear(year: number | undefined): number | null {
  if (year === undefined || Number.isNaN(year)) return null;
  if (year < MIN_PLAUSIBLE_YEAR || year > new Date().getFullYear() + 1) return null;
  return year;
}

/**
 * Converts a finished research-pipeline deep-search run into the same
 * `RawSpeciesRecord[]` shape GBIF/eBird/iNaturalist already produce, so
 * literature can be fed into `aggregateInventory` (normalizeBatch + the
 * backbone synonym/conflict pipeline) instead of bypassing it as an inert
 * "uploaded row" — see literatureProvider.ts for the sibling shape this
 * mirrors (metadata.reference/doi/url).
 *
 * One record per (species, contributing paper) — not one per species — so
 * each paper surfaces individually later as its own `publications` entry in
 * the Evidence panel, not collapsed into a single reference.
 *
 * Sets `occurrenceCount: 1` per record (a paper-mention count). Without this,
 * `aggregator.ts`'s `hasPositiveEvidence` filter — which requires at least
 * one source to report a real (>0) occurrence count — would silently drop
 * any species literature alone discovered. This is a latent bug in the
 * disabled `literatureProvider.ts`, which never sets `occurrenceCount`
 * either; not repeated here.
 */
export function toLiteratureRecords(results: DeepSearchResults): RawSpeciesRecord[] {
  const records: RawSpeciesRecord[] = [];
  for (const sp of results.species) {
    const documents = sp.documents.length > 0 ? sp.documents : [{ title: sp.scientificName, year: undefined, link: undefined }];
    for (const doc of documents) {
      records.push({
        source: "literature",
        scientificName: sp.scientificName,
        commonName: sp.commonName,
        occurrenceCount: 1,
        latestObservationDate: doc.year ? `${doc.year}-01-01` : undefined,
        earliestObservationDate: doc.year ? `${doc.year}-01-01` : undefined,
        metadata: {
          reference: doc.title,
          url: doc.link,
        },
      });
    }
  }
  return records;
}

/** Earliest/latest publication year across a set of literature records — for the "N papers · 1998–2024 range" subheading. */
export function literatureYearRange(records: RawSpeciesRecord[]): { earliest: number; latest: number } | null {
  const years: number[] = [];
  for (const record of records) {
    if (!record.latestObservationDate) continue;
    const year = plausibleYear(new Date(record.latestObservationDate).getFullYear());
    if (year !== null) years.push(year);
  }
  if (years.length === 0) return null;
  years.sort((a, b) => a - b);
  return { earliest: years[0], latest: years[years.length - 1] };
}

/**
 * Patches the aggregator's "literature" `SourceSummary` (if present) so its
 * subheading reads "N papers · 1998–2024 range" instead of the generic
 * "observations" fallback `aggregator.ts` uses for an unregistered provider —
 * literature's contributing evidence is publication years, not occurrence
 * counts, so the date span is the meaningful number to show here.
 */
export function withLiteratureDateRange(
  sourceSummary: SourceSummary[],
  literatureRecords: RawSpeciesRecord[] | undefined,
): SourceSummary[] {
  if (!literatureRecords?.length) return sourceSummary;
  const range = literatureYearRange(literatureRecords);
  if (!range) return sourceSummary;
  return sourceSummary.map((s) =>
    s.source === "literature"
      ? { ...s, occurrenceLabel: `papers · ${range.earliest}–${range.latest} range` }
      : s,
  );
}
