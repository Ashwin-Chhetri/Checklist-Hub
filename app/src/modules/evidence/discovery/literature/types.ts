/**
 * Literature evidence pipeline — real search results from OpenAlex, Crossref,
 * Semantic Scholar, and (optionally) BHL, heuristically ranked, with optional
 * LLM-assisted ranking/extraction layered on top. The LLM is never used to
 * "discover" literature — only to rank real search results and extract
 * species names from their text.
 */

export type LiteratureSource = "openalex" | "crossref" | "semanticscholar" | "bhl";

export interface LiteratureDocument {
  /** Dedupe key: DOI when present, else a normalized source+title hash. */
  id: string;
  title: string;
  abstract?: string;
  doi?: string;
  url?: string;
  year?: number;
  venue?: string;
  source: LiteratureSource;
  /** Heuristic relevance score set by ranking.ts; higher is more relevant. */
  relevanceScore: number;
  /** True when priorChecklist.ts classifies this as a likely existing checklist/survey for the taxon+region. */
  isLikelyExistingChecklist?: boolean;
}

export interface LiteratureSpeciesCandidate {
  scientificName: string;
  commonName?: string;
  sourceDocument: { title: string; doi?: string; url?: string; year?: number };
}

export interface LiteratureResponse {
  query: string;
  documentsFound: number;
  /** Top candidate documents after heuristic ranking. */
  candidateDocuments: LiteratureDocument[];
  /** True when NVIDIA_API_KEY + ENABLE_LITERATURE_AGENT=true are configured. */
  extractionEnabled: boolean;
  /** LLM-selected high-value checklist/survey documents (empty if extraction disabled). */
  selectedDocuments: LiteratureDocument[];
  /** Species extracted from selectedDocuments' text (empty if extraction disabled). */
  species: LiteratureSpeciesCandidate[];
  /**
   * Documents that look like an already-published checklist/survey for this
   * taxon group + region (e.g. "A checklist of birds of X district"), sorted
   * by year descending. Informational only — does not block checklist
   * creation. See priorChecklist.ts for the classification heuristic.
   */
  priorChecklists: LiteratureDocument[];
  message?: string;
}
