import { config } from "../config.js";

const BHL_API = "https://www.biodiversitylibrary.org/api3";

interface BhlPublication {
  TitleID?: number;
  Title?: string;
  TitleDOI?: string;
  PrimaryTitleUrl?: string;
  PublicationDate?: string;
}

export interface BhlSearchResult {
  titleId: number;
  title: string;
  doi?: string;
  url?: string;
  year?: number;
}

/**
 * Supplementary discovery role for pre-digital/historic taxonomic literature
 * that Google Scholar indexes poorly (this is what feeds the wiki's
 * "Historical Literature" page). Inactive (returns []) unless BHL_API_KEY is
 * configured. Never throws.
 */
export async function searchBhl(query: string, limit: number): Promise<BhlSearchResult[]> {
  const apiKey = config.bhlApiKey;
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
      .filter((item) => item.Title && item.TitleID)
      .map((item) => ({
        titleId: item.TitleID as number,
        title: item.Title as string,
        doi: item.TitleDOI,
        url: item.PrimaryTitleUrl,
        year: item.PublicationDate ? Number.parseInt(item.PublicationDate, 10) || undefined : undefined,
      }));
  } catch {
    return [];
  }
}

interface BhlItem {
  ItemID?: number;
}

interface BhlPage {
  OcrText?: string;
}

/**
 * Full-text role for BHL's own items (most have no DOI, so they never enter
 * the Crossref/Unpaywall/CORE chain — this is the only way to get their
 * text). Walks Title -> first Item -> Pages, concatenating OCR text. Best
 * effort: returns null on any failure, missing items, or empty OCR rather
 * than throwing — same "never block the pipeline" convention as every other
 * source in this module.
 */
export async function getBhlFullText(titleId: number): Promise<string | null> {
  const apiKey = config.bhlApiKey;
  if (!apiKey) return null;

  try {
    const titleUrl = new URL(BHL_API);
    titleUrl.searchParams.set("op", "GetTitleMetadata");
    titleUrl.searchParams.set("id", String(titleId));
    titleUrl.searchParams.set("items", "t");
    titleUrl.searchParams.set("apikey", apiKey);
    titleUrl.searchParams.set("format", "json");

    const titleResponse = await fetch(titleUrl.toString(), { signal: AbortSignal.timeout(10000) });
    if (!titleResponse.ok) return null;
    const titleData = (await titleResponse.json()) as { Result?: Array<{ Items?: BhlItem[] }> };
    const itemId = titleData.Result?.[0]?.Items?.[0]?.ItemID;
    if (!itemId) return null;

    const itemUrl = new URL(BHL_API);
    itemUrl.searchParams.set("op", "GetItemMetadata");
    itemUrl.searchParams.set("id", String(itemId));
    itemUrl.searchParams.set("pages", "t");
    itemUrl.searchParams.set("ocr", "t");
    itemUrl.searchParams.set("apikey", apiKey);
    itemUrl.searchParams.set("format", "json");

    const itemResponse = await fetch(itemUrl.toString(), { signal: AbortSignal.timeout(20000) });
    if (!itemResponse.ok) return null;
    const itemData = (await itemResponse.json()) as { Result?: Array<{ Pages?: BhlPage[] }> };
    const pages = itemData.Result?.[0]?.Pages ?? [];
    const text = pages
      .map((p) => p.OcrText ?? "")
      .filter(Boolean)
      .join("\n\n");
    return text.trim() || null;
  } catch {
    return null;
  }
}
