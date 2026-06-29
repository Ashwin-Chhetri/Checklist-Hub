import type { LiteratureDocument } from "../types";

const OPENALEX_API = "https://api.openalex.org/works";

interface OpenAlexLocation {
  landing_page_url?: string;
  source?: { display_name?: string };
}

interface OpenAlexWork {
  id: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: OpenAlexLocation;
}

/** Reconstructs a plain-text abstract from OpenAlex's inverted index format. */
function reconstructAbstract(index: Record<string, number[]> | undefined): string | undefined {
  if (!index) return undefined;
  const positions: Array<[number, string]> = [];
  for (const [word, idxs] of Object.entries(index)) {
    for (const i of idxs) positions.push([i, word]);
  }
  if (positions.length === 0) return undefined;
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, word]) => word).join(" ");
}

/** Searches OpenAlex (keyless) for works matching the query. Never throws. */
export async function searchOpenAlex(query: string, limit: number): Promise<LiteratureDocument[]> {
  try {
    const url = new URL(OPENALEX_API);
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", String(limit));
    if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];

    const data = (await response.json()) as { results?: OpenAlexWork[] };
    return (data.results ?? [])
      .filter((work) => work.display_name)
      .map((work) => ({
        id: work.doi ?? `openalex:${work.id}`,
        title: work.display_name as string,
        abstract: reconstructAbstract(work.abstract_inverted_index),
        doi: work.doi?.replace(/^https?:\/\/doi\.org\//, ""),
        url: work.primary_location?.landing_page_url,
        year: work.publication_year,
        venue: work.primary_location?.source?.display_name,
        source: "openalex" as const,
        relevanceScore: 0,
      }));
  } catch {
    return [];
  }
}
