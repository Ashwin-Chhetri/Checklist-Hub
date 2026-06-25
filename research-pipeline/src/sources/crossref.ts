import { config } from "../config.js";
import { recordHttpStatus } from "../util/httpSignals.js";

const CROSSREF_API = "https://api.crossref.org/works";

interface CrossrefItem {
  title?: string[];
  DOI?: string;
  URL?: string;
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Word-overlap ratio — good enough to reject an obviously-wrong Crossref match without a fuzzy-matching dependency. */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap += 1;
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export interface CrossrefDoiMatch {
  doi: string;
  venue?: string;
  year?: number;
}

export interface CrossrefSearchResult {
  title: string;
  doi?: string;
  url?: string;
  year?: number;
  venue?: string;
}

/**
 * Search/discovery role, re-promoted: Crossref was demoted to title→DOI
 * resolution only after keyword search surfaced wrong-region false
 * positives (a Darjeeling query returning Uttarakhand/Nepal results).
 * Re-enabled now that analysis/regionSpecificity.ts scores how specific a
 * result actually is to the requested region — false positives get sorted
 * down/flagged instead of polluting results undetected. Keyless, free —
 * no quota concern, unlike Google CSE.
 */
export async function searchCrossrefWorks(query: string, limit = 10): Promise<CrossrefSearchResult[]> {
  try {
    const url = new URL(CROSSREF_API);
    url.searchParams.set("query", query);
    url.searchParams.set("rows", String(limit));
    url.searchParams.set("select", "title,DOI,URL,container-title,published");
    if (config.crossrefMailto) url.searchParams.set("mailto", config.crossrefMailto);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return [];
    }

    const data = (await response.json()) as { message?: { items?: CrossrefItem[] } };
    return (data.message?.items ?? [])
      .filter((item) => item.title?.[0])
      .map((item) => ({
        title: item.title?.[0] as string,
        doi: item.DOI,
        url: item.URL,
        year: item.published?.["date-parts"]?.[0]?.[0],
        venue: item["container-title"]?.[0],
      }));
  } catch {
    return [];
  }
}

/**
 * Title -> DOI resolution role: given a title already found by some other
 * source (Scholar, curated web search, citation-graph), resolves its DOI.
 * Returns null rather than a low-confidence guess when no candidate title
 * is similar enough. (Crossref's *search* role, demoted then re-promoted,
 * lives in searchCrossrefWorks above — this function is unrelated to that
 * decision and keeps its original job either way.)
 */
export async function resolveDoiByTitle(title: string): Promise<CrossrefDoiMatch | null> {
  try {
    const url = new URL(CROSSREF_API);
    url.searchParams.set("query.bibliographic", title);
    url.searchParams.set("rows", "3");
    url.searchParams.set("select", "title,DOI,container-title,published");
    if (config.crossrefMailto) url.searchParams.set("mailto", config.crossrefMailto);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const data = (await response.json()) as { message?: { items?: CrossrefItem[] } };
    for (const item of data.message?.items ?? []) {
      const candidateTitle = item.title?.[0];
      if (!candidateTitle || !item.DOI) continue;
      if (titleSimilarity(title, candidateTitle) >= 0.6) {
        return {
          doi: item.DOI,
          venue: item["container-title"]?.[0],
          year: item.published?.["date-parts"]?.[0]?.[0],
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
