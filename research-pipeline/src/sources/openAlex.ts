import { config } from "../config.js";
import { recordHttpStatus } from "../util/httpSignals.js";

const OPENALEX_API = "https://api.openalex.org/works";

interface OpenAlexLocation {
  landing_page_url?: string;
  pdf_url?: string;
  is_oa?: boolean;
  source?: { display_name?: string };
}

interface OpenAlexWork {
  display_name?: string;
  publication_year?: number;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: OpenAlexLocation;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  doi?: string;
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

export interface OpenAlexEnrichment {
  title?: string;
  abstract?: string;
  venue?: string;
  year?: number;
  isOa: boolean;
  oaUrl?: string;
}

/**
 * Metadata enrichment role: direct work lookup by DOI — "given a DOI we
 * already have, fill in abstract/venue/OA status." Unaffected by
 * OpenAlex's search role (demoted then re-promoted, see
 * searchOpenAlexWorks below) — this function keeps its original job either way.
 */
export async function getWorkByDoi(doi: string): Promise<OpenAlexEnrichment | null> {
  try {
    const url = new URL(`${OPENALEX_API}/doi:${encodeURIComponent(doi)}`);
    if (config.openAlexMailto) url.searchParams.set("mailto", config.openAlexMailto);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const work = (await response.json()) as OpenAlexWork;
    return {
      title: work.display_name,
      abstract: reconstructAbstract(work.abstract_inverted_index),
      venue: work.primary_location?.source?.display_name,
      year: work.publication_year,
      isOa: Boolean(work.open_access?.is_oa ?? work.primary_location?.is_oa),
      oaUrl: work.open_access?.oa_url ?? work.primary_location?.pdf_url ?? undefined,
    };
  } catch {
    return null;
  }
}

export interface OpenAlexSearchResult {
  title: string;
  doi?: string;
  abstract?: string;
  venue?: string;
  year?: number;
}

/**
 * Search/discovery role, re-promoted for the same reason as Crossref's
 * searchCrossrefWorks (see that file's comment) — demoted earlier this
 * project for wrong-region false positives, safe again now that
 * analysis/regionSpecificity.ts flags/sorts those down instead of letting
 * them pollute results undetected. Keyless, free.
 */
export async function searchOpenAlexWorks(query: string, limit = 10): Promise<OpenAlexSearchResult[]> {
  try {
    const url = new URL(OPENALEX_API);
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", String(Math.min(limit, 25)));
    if (config.openAlexMailto) url.searchParams.set("mailto", config.openAlexMailto);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return [];
    }

    const data = (await response.json()) as { results?: OpenAlexWork[] };
    return (data.results ?? [])
      .filter((work) => work.display_name)
      .map((work) => ({
        title: work.display_name as string,
        doi: work.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
        abstract: reconstructAbstract(work.abstract_inverted_index),
        venue: work.primary_location?.source?.display_name,
        year: work.publication_year,
      }));
  } catch {
    return [];
  }
}
