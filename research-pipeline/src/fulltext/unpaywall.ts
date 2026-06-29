import { config } from "../config.js";
import { recordHttpStatus } from "../util/httpSignals.js";

const UNPAYWALL_API = "https://api.unpaywall.org/v2";

interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url?: string | null;
}

interface UnpaywallResponse {
  is_oa?: boolean;
  best_oa_location?: UnpaywallLocation | null;
}

export interface OpenAccessLocation {
  pdfUrl?: string;
  landingUrl?: string;
}

/**
 * DOI -> legal open-access location. Requires a contact email per
 * Unpaywall's API terms (not an API key — just a real, monitored address).
 * Returns null when there's no OA copy (the caller must then try CORE/BHL
 * or fall back to metadata-only) — never falls back to scraping a paywalled
 * copy.
 */
export async function resolveOpenAccess(doi: string): Promise<OpenAccessLocation | null> {
  if (!config.unpaywallEmail) return null;

  try {
    const url = new URL(`${UNPAYWALL_API}/${encodeURIComponent(doi)}`);
    url.searchParams.set("email", config.unpaywallEmail);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const data = (await response.json()) as UnpaywallResponse;
    if (!data.is_oa || !data.best_oa_location) return null;

    return {
      pdfUrl: data.best_oa_location.url_for_pdf ?? undefined,
      landingUrl: data.best_oa_location.url ?? undefined,
    };
  } catch {
    return null;
  }
}
