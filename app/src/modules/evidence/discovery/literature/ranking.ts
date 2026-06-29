import type { LiteratureDocument } from "./types";

/** Phrases that indicate a regional checklist/survey-style publication. */
const CHECKLIST_KEYWORDS = [
  "checklist",
  "annotated list",
  "fauna of",
  "avifauna",
  "flora of",
  "survey",
  "diversity",
  "new record",
  "inventory",
  "species composition",
  "distribution",
];

const CURRENT_YEAR = new Date().getFullYear();

/** Heuristic relevance score for a document given the taxon group + region. */
export function scoreDocument(doc: LiteratureDocument, taxonGroup: string, regionName: string): number {
  const text = `${doc.title} ${doc.abstract ?? ""}`.toLowerCase();
  const taxon = taxonGroup.toLowerCase();
  const region = regionName.toLowerCase();

  let score = 0;
  for (const keyword of CHECKLIST_KEYWORDS) {
    if (text.includes(keyword)) score += 2;
  }
  if (text.includes(taxon)) score += 3;
  if (region && text.includes(region)) score += 4;
  if (doc.abstract) score += 1;
  if (doc.year && CURRENT_YEAR - doc.year <= 15) score += 1;

  return score;
}

/** Scores, sorts (descending), and returns the top `limit` documents. */
export function rankDocuments(
  docs: LiteratureDocument[],
  taxonGroup: string,
  regionName: string,
  limit = 10,
): LiteratureDocument[] {
  return docs
    .map((doc) => ({ ...doc, relevanceScore: scoreDocument(doc, taxonGroup, regionName) }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}
