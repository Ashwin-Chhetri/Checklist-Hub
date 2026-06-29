import { config } from "../config.js";
import { recordHttpStatus } from "../util/httpSignals.js";

const S2_API = "https://api.semanticscholar.org/graph/v1/paper";

interface S2RelatedItem {
  title?: string;
  year?: number;
  externalIds?: { DOI?: string };
}

export interface RelatedPaper {
  title: string;
  year?: number;
  doi?: string;
}

function headers(): Record<string, string> {
  return config.semanticScholarApiKey ? { "x-api-key": config.semanticScholarApiKey } : {};
}

async function fetchRelated(doi: string, relation: "references" | "citations"): Promise<RelatedPaper[]> {
  try {
    const wrapperKey = relation === "references" ? "citedPaper" : "citingPaper";
    const url = new URL(`${S2_API}/DOI:${encodeURIComponent(doi)}/${relation}`);
    url.searchParams.set("fields", `${wrapperKey}.title,${wrapperKey}.year,${wrapperKey}.externalIds`);
    url.searchParams.set("limit", "50");

    const response = await fetch(url.toString(), { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return [];
    }

    const data = (await response.json()) as { data?: Array<Record<string, S2RelatedItem>> };
    return (data.data ?? [])
      .map((item) => item[wrapperKey])
      .filter((p): p is S2RelatedItem => Boolean(p?.title))
      .map((p) => ({ title: p.title as string, year: p.year, doi: p.externalIds?.DOI }));
  } catch {
    return [];
  }
}

/**
 * Citation graph role — this is what powers Phase B discovery
 * (discovery/citationExpansion.ts): papers a seed cites, and papers that
 * cite the seed, one hop. Semantic Scholar is deliberately not used as a
 * search/discovery engine by query anymore (see discovery/scholarSearch.ts).
 */
export async function getReferences(doi: string): Promise<RelatedPaper[]> {
  return fetchRelated(doi, "references");
}

export async function getCitations(doi: string): Promise<RelatedPaper[]> {
  return fetchRelated(doi, "citations");
}

/** Citation-count enrichment role. */
export async function getCitationCount(doi: string): Promise<number | null> {
  try {
    const url = new URL(`${S2_API}/DOI:${encodeURIComponent(doi)}`);
    url.searchParams.set("fields", "citationCount");

    const response = await fetch(url.toString(), { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const data = (await response.json()) as { citationCount?: number };
    return data.citationCount ?? null;
  } catch {
    return null;
  }
}
