/**
 * Cheap, network-free accessibility estimate for the discovery/ranking
 * stage — the user's explicit concern: "discovering [literature] without
 * the means to read them extract information from them is not a good idea."
 * Stage A already has everything needed for this for free: OpenAlex's
 * isOa/oaUrl come back as part of the same getWorkByDoi enrichment call
 * buildPaperMetadata.ts already makes for abstract/venue, just not captured
 * before now. No new network calls — the real OA resolution chain
 * (Unpaywall -> CORE -> BHL, an actual download attempt) still only runs in
 * Stage B (fulltext/resolveFullText.ts) once a paper has survived review.
 */

/** Hosts known to serve full text without a subscription. */
const KNOWN_OPEN_HOSTS = [
  "biodiversitylibrary.org",
  "zenodo.org",
  "pmc.ncbi.nlm.nih.gov",
  "core.ac.uk",
  "doaj.org",
  "books.google.com",
];

/** Publisher hosts that typically gate the full article behind a subscription/paywall unless an OA flag says otherwise. */
const KNOWN_PAYWALLED_HOSTS = ["sciencedirect.com", "springer.com", "cambridge.org", "tandfonline.com", "wiley.com"];

export interface AccessibilitySignalResult {
  /** 0-100, fed into scorePreliminaryRelevance as the "can we actually get full text for this" dimension. */
  score: number;
  reasons: string[];
}

export function checkAccessibilitySignal(input: {
  doi?: string;
  url?: string;
  isOa?: boolean;
  oaUrl?: string;
}): AccessibilitySignalResult {
  const reasons: string[] = [];

  if (input.isOa || input.oaUrl) {
    reasons.push("OpenAlex confirms an open-access location exists.");
    return { score: 90, reasons };
  }

  const url = (input.url ?? "").toLowerCase();
  if (KNOWN_OPEN_HOSTS.some((host) => url.includes(host))) {
    reasons.push("Hosted on a known open-access repository.");
    return { score: 80, reasons };
  }

  if (input.isOa === false) {
    reasons.push("OpenAlex reports no open-access copy available.");
  }

  if (KNOWN_PAYWALLED_HOSTS.some((host) => url.includes(host))) {
    reasons.push("Hosted on a publisher domain that typically requires subscription access.");
    return { score: input.doi ? 35 : 20, reasons };
  }

  if (input.doi) {
    reasons.push("Has a DOI but open-access status is unconfirmed — may still resolve via Unpaywall/CORE at the full-text stage.");
    return { score: 50, reasons };
  }

  reasons.push("No DOI and no recognized host — full-text access is unconfirmed and may not be resolvable at all.");
  return { score: 35, reasons };
}
