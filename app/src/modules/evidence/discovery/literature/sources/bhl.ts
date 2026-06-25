import type { LiteratureDocument } from "../types";

const BHL_API = "https://www.biodiversitylibrary.org/api3";

interface BhlPublication {
  Title?: string;
  TitleDOI?: string;
  PrimaryTitleUrl?: string;
  PublicationDate?: string;
}

/**
 * Searches the Biodiversity Heritage Library for publications matching the
 * query. Inactive (returns []) unless BHL_API_KEY is configured. Never throws.
 */
export async function searchBhl(query: string, limit: number): Promise<LiteratureDocument[]> {
  const apiKey = process.env.BHL_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL(BHL_API);
    url.searchParams.set("op", "PublicationSearch");
    url.searchParams.set("searchterm", query);
    url.searchParams.set("searchtype", "F");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];

    const data = (await response.json()) as { Result?: BhlPublication[] };
    return (data.Result ?? [])
      .slice(0, limit)
      .filter((item) => item.Title)
      .map((item) => ({
        id: item.TitleDOI ?? `bhl:${item.Title}`,
        title: item.Title as string,
        doi: item.TitleDOI,
        url: item.PrimaryTitleUrl,
        year: item.PublicationDate ? Number.parseInt(item.PublicationDate, 10) || undefined : undefined,
        source: "bhl" as const,
        relevanceScore: 0,
      }));
  } catch {
    return [];
  }
}
