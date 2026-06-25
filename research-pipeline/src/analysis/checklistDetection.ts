/** Title phrases that strongly suggest a regional checklist/survey publication — ported from the app's literature/priorChecklist.ts CHECKLIST_PHRASES list, kept here as a cheap signal fed into the LLM prompt rather than the final verdict. */
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
  // Older systematic catalogues read the same way a modern checklist does
  // (e.g. "Catalogue of Birds in the Indian Museum, Calcutta") — without
  // this, the heuristic fallback (no LLM configured) misclassified them as
  // "other", which a user reported as confusing ("books" not showing up
  // anywhere in the breakdown).
  "catalogue of",
  "catalog of",
];

export type DocumentType = "checklist" | "scientific_paper" | "other";

export interface ChecklistVerdict {
  documentType: DocumentType;
  reasons: string[];
}

function heuristicSignal(title: string): boolean {
  const lower = title.toLowerCase();
  return CHECKLIST_PHRASES.some((phrase) => lower.includes(phrase));
}

/** Heuristic-only fallback (no LLM): checklist phrase match -> checklist; has venue/abstract (looks like a normal paper) -> scientific_paper; else -> other. Exported so batchExtraction.ts can reuse it as its own failure/no-LLM fallback instead of duplicating this logic. */
export function heuristicChecklistVerdict(input: { title: string; venue?: string; abstract?: string }): ChecklistVerdict {
  if (heuristicSignal(input.title)) {
    return { documentType: "checklist", reasons: ["Title matches a known checklist/survey phrase pattern."] };
  }
  if (input.venue || input.abstract) {
    return { documentType: "scientific_paper", reasons: ["Has a venue/abstract, consistent with a peer-reviewed paper."] };
  }
  return { documentType: "other", reasons: ["No checklist phrase match and no venue/abstract."] };
}
