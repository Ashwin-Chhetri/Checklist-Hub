import type { LiteratureDocument } from "../types";

const S2_API = "https://api.semanticscholar.org/graph/v1/paper/search";

interface S2Paper {
  title?: string;
  abstract?: string;
  year?: number;
  venue?: string;
  url?: string;
  externalIds?: { DOI?: string };
}

/** Searches Semantic Scholar (keyless, rate-limited) for works matching the query. Never throws. */
export async function searchSemanticScholar(query: string, limit: number): Promise<LiteratureDocument[]> {
  try {
    const url = new URL(S2_API);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("fields", "title,abstract,year,venue,externalIds,url");

    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;

    const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];

    const data = (await response.json()) as { data?: S2Paper[] };
    return (data.data ?? [])
      .filter((paper) => paper.title)
      .map((paper) => ({
        id: paper.externalIds?.DOI ?? `s2:${paper.title}`,
        title: paper.title as string,
        abstract: paper.abstract,
        doi: paper.externalIds?.DOI,
        url: paper.url,
        year: paper.year,
        venue: paper.venue,
        source: "semanticscholar" as const,
        relevanceScore: 0,
      }));
  } catch {
    return [];
  }
}
