import fs from "node:fs/promises";
import { callDataService } from "@/lib/dataService.server";

// Thin HTTP client for the standalone research-pipeline service, which runs
// on the same DigitalOcean droplet as the GBIF/GADM reference-data-service —
// Vercel's serverless functions can't spawn long-lived detached child
// processes or hold a persistent on-disk corpus, so this calls the service
// over HTTP instead of `spawn`-ing research-pipeline/src/cli.ts as a local
// sibling process (which only ever worked in local dev). See
// research-pipeline/src/server.ts for the server side.

export function isResearchPipelineAvailable(): { available: boolean; reason?: string } {
  if (!process.env.DATA_SERVICE_URL || !process.env.DATA_SERVICE_SECRET) {
    return { available: false, reason: "DATA_SERVICE_URL / DATA_SERVICE_SECRET are not configured." };
  }
  return { available: true };
}

export function startResearchRun(params: {
  runId: string;
  region: string;
  taxonGroup: string;
  resultsPerQuery?: number;
}): void {
  callDataService("/research/run", { method: "POST", body: JSON.stringify(params) }).catch((err) => {
    console.error(`[research] failed to start run ${params.runId}:`, err);
  });
}

export function startResearchContinue(runId: string): void {
  callDataService(`/research/run/${runId}/continue`, { method: "POST", body: JSON.stringify({}) }).catch((err) => {
    console.error(`[research] failed to continue run ${runId}:`, err);
  });
}

export interface CatalogEntryResult {
  slug: string;
  title: string;
  doi?: string;
  url?: string;
  year?: number;
  region: string[];
  taxa: string[];
  region_relevance?: number;
  taxon_relevance?: number;
  discoveredVia: string;
}

/**
 * Ingests a user-supplied paper (link or already-uploaded local PDF path)
 * via the remote service — single-paper ingestion is fast enough to await
 * directly in the API route, unlike startResearchRun.
 */
export async function runContribute(params: {
  region: string;
  taxonGroup: string;
  url?: string;
  pdfPath?: string;
}): Promise<{ ok: boolean; output: string; entry: CatalogEntryResult | null }> {
  const baseUrl = process.env.DATA_SERVICE_URL;
  const secret = process.env.DATA_SERVICE_SECRET;
  if (!baseUrl || !secret) {
    return { ok: false, output: "DATA_SERVICE_URL / DATA_SERVICE_SECRET are not configured.", entry: null };
  }

  try {
    const form = new FormData();
    form.set("region", params.region);
    form.set("taxonGroup", params.taxonGroup);
    if (params.url) form.set("url", params.url);
    if (params.pdfPath) {
      const buffer = await fs.readFile(params.pdfPath);
      form.set("file", new Blob([buffer]), "contribution.pdf");
    }

    const res = await fetch(`${baseUrl}/research/contribute`, {
      method: "POST",
      headers: { "x-internal-secret": secret },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, output: text, entry: null };
    const parsed = JSON.parse(text) as { ok: boolean; entry: CatalogEntryResult };
    return { ok: parsed.ok, output: text, entry: parsed.entry ?? null };
  } catch (err) {
    return { ok: false, output: String(err), entry: null };
  }
}

/** Withdraws a manually-contributed paper. */
export async function runRemoveContribution(slug: string): Promise<{ ok: boolean; removed: boolean; reason?: string }> {
  try {
    const result = await callDataService<{ removed: boolean; reason?: string }>("/research/contribute", {
      method: "DELETE",
      body: JSON.stringify({ slug }),
    });
    return { ok: true, removed: result.removed, reason: result.reason };
  } catch (err) {
    return { ok: false, removed: false, reason: String(err) };
  }
}

/** Excludes (or restores) a candidate from a run's pre-fulltext review pool. */
export async function runExcludeCandidate(runId: string, slug: string, excluded: boolean): Promise<{ ok: boolean; excluded?: boolean; reason?: string }> {
  try {
    const result = await callDataService<{ ok: boolean; excluded?: boolean; reason?: string }>("/research/exclude-candidate", {
      method: "POST",
      body: JSON.stringify({ runId, slug, excluded }),
    });
    return result;
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

/** Soft-deletes (or restores) a *discovered* document from region+taxon listings. */
export async function runSetDocumentExcluded(slug: string, excluded: boolean): Promise<{ ok: boolean; excluded?: boolean; reason?: string }> {
  try {
    const result = await callDataService<{ ok: boolean; excluded?: boolean; reason?: string }>("/research/exclude-document", {
      method: "POST",
      body: JSON.stringify({ slug, excluded }),
    });
    return result;
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

export interface RunStatus {
  runId: string;
  region: string;
  taxonGroup: string;
  phase: string;
  startedAt: string;
  updatedAt: string;
  counts: Record<string, number>;
  error?: string;
  llmEnabled?: boolean;
  sourceOutcomes?: Array<{
    source: "scholar" | "curated_web_search" | "crossref" | "openalex";
    status: "ok" | "empty" | "error";
    count: number;
    message?: string;
  }>;
}

export async function fetchRunStatus(runId: string): Promise<RunStatus | null> {
  try {
    return await callDataService<RunStatus>(`/research/run/${runId}/status`);
  } catch {
    return null;
  }
}

export interface ReviewCandidateMetadata {
  slug: string;
  title: string;
  doi?: string;
  url?: string;
  authors?: string;
  year?: number;
}

export interface ReviewCandidateRecord {
  metadata: ReviewCandidateMetadata;
  score: number;
  regionScore: number;
  taxonScore: number;
  documentType: "checklist" | "scientific_paper" | "other";
  citable: boolean;
  greySignalCredible?: boolean;
  speciesRecordScore: number;
  accessibilityScore: number;
  excluded: boolean;
}

export async function fetchReviewCandidates(runId: string): Promise<ReviewCandidateRecord[] | null> {
  try {
    return await callDataService<ReviewCandidateRecord[] | null>(`/research/run/${runId}/candidates`);
  } catch {
    return null;
  }
}

export interface CatalogEntry {
  slug: string;
  title: string;
  doi?: string;
  url?: string;
  authors?: string;
  year?: number;
  llm_relevance?: number;
  region_relevance?: number;
  taxon_relevance?: number;
  region: string[];
  taxa: string[];
  documentType: "checklist" | "scientific_paper" | "other";
  greySignalCredible?: boolean;
  historical: boolean;
  has_coordinates: boolean;
  discoveredVia: string;
  excluded?: boolean;
  flagged?: boolean;
  flagReason?: string;
  regionContainment?: "within" | "broader" | "unrelated" | "unverified";
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  try {
    return await callDataService<CatalogEntry[]>("/research/catalog");
  } catch {
    return [];
  }
}

export interface LlmAnalysis {
  species?: Array<{
    scientificName: string;
    commonName?: string;
    backboneCommonName?: string;
    backboneValidated?: boolean;
    flagged?: boolean;
    flagReason?: string;
    acceptedScientificName?: string;
  }>;
  coordinates?: Array<{ species?: string; lat: number; lng: number; outOfRangeSuspect?: boolean }>;
}

/** Batched fetch of each slug's latest LLM analysis — one round trip instead of N. */
export async function fetchPapersAnalysis(slugs: string[]): Promise<Map<string, LlmAnalysis | null>> {
  if (slugs.length === 0) return new Map();
  try {
    const out = await callDataService<Record<string, LlmAnalysis | null>>("/research/papers-analysis", {
      method: "POST",
      body: JSON.stringify({ slugs }),
    });
    return new Map(Object.entries(out));
  } catch {
    return new Map(slugs.map((slug) => [slug, null]));
  }
}
