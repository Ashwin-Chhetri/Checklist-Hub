import { config } from "../config.js";
import { recordHttpStatus } from "../util/httpSignals.js";

const CORE_API = "https://api.core.ac.uk/v3/search/works";

interface CoreWork {
  doi?: string;
  downloadUrl?: string;
}

/**
 * Open-access PDF resolution role. Optional — requires a free CORE API key
 * (https://core.ac.uk/services/api); when unset, behaves like bhl.ts without
 * BHL_API_KEY (returns null immediately, never blocks the full-text chain).
 */
export async function findOpenAccessPdf(params: { doi?: string; title: string }): Promise<string | null> {
  const apiKey = config.coreApiKey;
  if (!apiKey) return null;

  try {
    const q = params.doi ? `doi:"${params.doi}"` : `title:"${params.title.replace(/"/g, "'")}"`;
    const url = new URL(CORE_API);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "3");

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const data = (await response.json()) as { results?: CoreWork[] };
    const hit = data.results?.find((r) => r.downloadUrl);
    return hit?.downloadUrl ?? null;
  } catch {
    return null;
  }
}
