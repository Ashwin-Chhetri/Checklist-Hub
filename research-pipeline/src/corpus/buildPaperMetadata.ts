import { resolveDoiByTitle } from "../sources/crossref.js";
import { getWorkByDoi } from "../sources/openAlex.js";
import { getCitationCount } from "../sources/semanticScholar.js";
import { pathExists, paperDir, writeRawJson, writeRawFile } from "./rawStore.js";
import type { PaperCandidate, PaperMetadata } from "../types.js";
import path from "node:path";

/**
 * Per-paper enrichment: resolve a DOI when the candidate doesn't already
 * have one (Crossref, title -> DOI), then enrich via OpenAlex (abstract,
 * venue, OA status) and Semantic Scholar (citation count) when a DOI is
 * available. Skips work entirely if raw/papers/<slug>/metadata.json already
 * exists — raw/ is immutable/append-only, re-runs should not re-fetch.
 */
export async function buildPaperMetadata(candidate: PaperCandidate): Promise<PaperMetadata> {
  const existing = await pathExists(path.join(paperDir(candidate.slug), "metadata.json"));
  if (existing) {
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(paperDir(candidate.slug), "metadata.json"), "utf8"),
    );
    return JSON.parse(raw) as PaperMetadata;
  }

  let doi = candidate.doi;
  if (!doi) {
    const match = await resolveDoiByTitle(candidate.title);
    if (match) doi = match.doi;
  }

  let abstract: string | undefined;
  let venue: string | undefined;
  let year = candidate.year;
  let citedByCount: number | undefined = candidate.scholar?.CitedBy;
  let isOa: boolean | undefined;
  let oaUrl: string | undefined;

  if (doi) {
    const enrichment = await getWorkByDoi(doi);
    if (enrichment) {
      abstract = enrichment.abstract;
      venue = enrichment.venue;
      year = year ?? enrichment.year;
      isOa = enrichment.isOa;
      oaUrl = enrichment.oaUrl;
    }
    const citationCount = await getCitationCount(doi);
    if (citationCount !== null) citedByCount = citationCount;
  }

  const metadata: PaperMetadata = {
    slug: candidate.slug,
    title: candidate.title,
    doi,
    year,
    authors: candidate.authorsLine,
    venue,
    abstract,
    url: candidate.url,
    discoveredVia: candidate.discoveredVia,
    expandedFrom: candidate.expandedFrom,
    fullTextStatus: "metadata_only",
    citedByCount,
    isOa,
    oaUrl,
    createdAt: new Date().toISOString(),
  };

  await writeRawJson(candidate.slug, "metadata.json", metadata);
  if (candidate.scholar) {
    await writeRawJson(candidate.slug, "scholar.json", candidate.scholar);
  }
  return metadata;
}

export { writeRawFile };
