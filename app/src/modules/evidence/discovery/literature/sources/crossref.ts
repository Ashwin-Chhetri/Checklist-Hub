import type { LiteratureDocument } from "../types";

const CROSSREF_API = "https://api.crossref.org/works";

interface CrossrefItem {
  title?: string[];
  abstract?: string;
  DOI?: string;
  URL?: string;
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
}

/** Strips JATS/XML markup (e.g. "<jats:p>...</jats:p>") from a Crossref abstract. */
function cleanAbstract(abstract: string | undefined): string | undefined {
  if (!abstract) return undefined;
  const text = abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Searches Crossref (keyless) for works matching the query. Never throws. */
export async function searchCrossref(query: string, limit: number): Promise<LiteratureDocument[]> {
  try {
    const url = new URL(CROSSREF_API);
    url.searchParams.set("query", query);
    url.searchParams.set("rows", String(limit));
    url.searchParams.set("select", "title,abstract,DOI,URL,container-title,published");
    if (process.env.CROSSREF_MAILTO) url.searchParams.set("mailto", process.env.CROSSREF_MAILTO);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];

    const data = (await response.json()) as { message?: { items?: CrossrefItem[] } };
    return (data.message?.items ?? [])
      .filter((item) => item.title?.[0])
      .map((item) => ({
        id: item.DOI ?? `crossref:${item.title?.[0]}`,
        title: item.title?.[0] as string,
        abstract: cleanAbstract(item.abstract),
        doi: item.DOI,
        url: item.URL,
        year: item.published?.["date-parts"]?.[0]?.[0],
        venue: item["container-title"]?.[0],
        source: "crossref" as const,
        relevanceScore: 0,
      }));
  } catch {
    return [];
  }
}
