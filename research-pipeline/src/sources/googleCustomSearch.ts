import { config, isGoogleCseEnabled } from "../config.js";

const GOOGLE_CSE_API = "https://www.googleapis.com/customsearch/v1";

interface GoogleCseItem {
  title?: string;
  link?: string;
  snippet?: string;
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
  queries?: { nextPage?: Array<{ startIndex?: number }> };
}

export interface GoogleCseResult {
  title: string;
  link: string;
  snippet?: string;
}

export interface GoogleCseSearchResponse {
  results: GoogleCseResult[];
  hasMore: boolean;
}

/**
 * Curated-domain discovery role: Google Custom Search JSON API, restricted
 * (by the caller, via discovery/curatedDomains.ts's site: OR-clauses baked
 * into `query`) to a fixed list of trusted biodiversity-literature domains.
 * Free tier is a hard 100 queries/day cap — gated like core.ts/bhl.ts
 * (returns immediately, never blocks the pipeline) when either
 * GOOGLE_CSE_API_KEY or GOOGLE_CSE_ID is unset, and callers should use
 * discovery/queryCache.ts to avoid burning quota on repeated test runs.
 */
export async function searchGoogleCse(query: string, num = 10, start?: number): Promise<GoogleCseSearchResponse> {
  if (!isGoogleCseEnabled()) return { results: [], hasMore: false };

  try {
    const url = new URL(GOOGLE_CSE_API);
    url.searchParams.set("key", config.googleCseApiKey as string);
    url.searchParams.set("cx", config.googleCseId as string);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(Math.max(1, num), 10)));
    if (start) url.searchParams.set("start", String(start));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { results: [], hasMore: false };

    const data = (await response.json()) as GoogleCseResponse;
    const results = (data.items ?? [])
      .filter((item): item is GoogleCseItem & { title: string; link: string } => Boolean(item.title && item.link))
      .map((item) => ({ title: item.title, link: item.link, snippet: item.snippet }));

    const nextStart = data.queries?.nextPage?.[0]?.startIndex;
    return { results, hasMore: typeof nextStart === "number" };
  } catch {
    return { results: [], hasMore: false };
  }
}
