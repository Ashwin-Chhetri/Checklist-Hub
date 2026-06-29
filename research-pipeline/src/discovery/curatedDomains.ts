/**
 * Curated, user-editable allow-list of trusted biodiversity-literature
 * domains for the Google Custom Search discovery source — drawn from
 * domains that already showed up as real, relevant results in this
 * project's own Scholar-based test runs (Indian/Himalayan biodiversity
 * literature). Add/remove domains here as needed; no other code changes
 * required.
 */
export const CURATED_DOMAINS = [
  "indianbirds.in",
  "recordsofzsi.com",
  "zsi.gov.in",
  "threatenedtaxa.org",
  "biodiversitylibrary.org",
  "researchgate.net",
  "academia.edu",
  "springer.com",
  "cambridge.org",
  "sciencedirect.com",
  "mdpi.com",
  "frontiersin.org",
  "tandfonline.com",
  "wiley.com",
  "pmc.ncbi.nlm.nih.gov",
  "books.google.com",
  "zenodo.org",
];

// Sized so the current 17-domain list produces exactly one chunk (one
// query, not several) — ~28 chars/domain ("site:x.com OR ") × 40 ≈ 1120
// chars, comfortably under Google's ~2048-char practical query-length
// limit even with the taxon+region terms prepended. Only domain lists
// larger than this actually split into multiple (quota-consuming) chunks.
const CHUNK_SIZE = 40;

/**
 * Groups domains into `(site:a OR site:b OR ...)` clauses, chunked so a
 * single query stays well under Google's practical query-length limits
 * even as CURATED_DOMAINS grows. Each chunk counts as one separate
 * quota-consuming request when used.
 */
export function buildSiteRestrictionChunks(domains: string[] = CURATED_DOMAINS): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
    const chunk = domains.slice(i, i + CHUNK_SIZE);
    chunks.push(`(${chunk.map((d) => `site:${d}`).join(" OR ")})`);
  }
  return chunks;
}
