import type { LiteratureDocument } from "./types";

/** Title phrases that strongly indicate a regional checklist/survey publication. */
const CHECKLIST_PHRASES = [
  "checklist of",
  "an annotated checklist",
  "annotated list of",
  "avifauna of",
  "fauna of",
  "flora of",
  "an inventory of",
  "species inventory of",
  "species list of",
  "list of birds of",
  "list of mammals of",
  "list of species of",
  "biodiversity of",
];

/** First significant word of a multi-word region name (e.g. "Darjeeling" from "Darjeeling district"). */
function regionToken(regionName: string): string {
  const words = regionName.trim().toLowerCase().split(/\s+/);
  return words[0] ?? "";
}

/**
 * Heuristically flags a document as a likely *existing* checklist/survey for
 * the same taxon group + region — distinct from "this paper mentions some
 * species from this group". Requires a checklist-style title phrase AND a
 * region-name match; a taxon-name match in the title further increases
 * confidence but isn't required (titles often say "birds"/"avifauna" rather
 * than the scientific taxon name).
 */
export function classifyPriorChecklist(doc: LiteratureDocument, taxonGroup: string, regionName: string): boolean {
  const title = doc.title.toLowerCase();
  const region = regionName.trim().toLowerCase();
  const token = regionToken(regionName);

  const hasChecklistPhrase = CHECKLIST_PHRASES.some((phrase) => title.includes(phrase));
  if (!hasChecklistPhrase) return false;

  const regionMatches = (region && title.includes(region)) || (token.length >= 3 && title.includes(token));
  return regionMatches;
}

/**
 * Filters and sorts documents that look like prior checklist/survey
 * publications for this taxon group + region, most recent first, capped at
 * `limit`. Stamps `isLikelyExistingChecklist: true` on returned documents.
 */
export function findPriorChecklists(
  docs: LiteratureDocument[],
  taxonGroup: string,
  regionName: string,
  limit = 5,
): LiteratureDocument[] {
  return docs
    .filter((doc) => classifyPriorChecklist(doc, taxonGroup, regionName))
    .map((doc) => ({ ...doc, isLikelyExistingChecklist: true }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, limit);
}
