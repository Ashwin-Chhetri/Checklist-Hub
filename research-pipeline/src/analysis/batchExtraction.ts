import { callLlm, isLlmEnabled, extractJson, getBatchSize, recordBatchOutcome, availableLanes, type LlmLane } from "./llmClient.js";
import { matchAgainstBackbone } from "./backboneMatch.js";
import { heuristicChecklistVerdict } from "./checklistDetection.js";
import { heuristicRelevanceVerdict } from "./relevanceScoring.js";
import type { DocumentType, ExtractedSpeciesRecord } from "../types.js";

export interface BatchExtractionInput {
  slug: string;
  title: string;
  abstract?: string;
  fullText?: string;
}

export interface BatchExtractionResult {
  slug: string;
  documentType: DocumentType;
  semanticRanking: number;
  regionRelevance: number;
  taxonRelevance: number;
  historicalImportance: number;
  species: ExtractedSpeciesRecord[];
}

interface RawSpeciesItem {
  scientificName?: string;
  commonName?: string | null;
  occurrence?: string | null;
  location?: string | null;
  dateRange?: { from?: string | null; to?: string | null } | null;
  sourceSentence?: string;
}

interface RawBatchItem {
  id?: string;
  documentType?: string;
  semanticRanking?: number;
  regionRelevance?: number;
  taxonRelevance?: number;
  historicalImportance?: number;
  species?: RawSpeciesItem[];
}

/**
 * Replaces what used to be three separate per-paper LLM calls
 * (detectChecklist + scoreRelevance + extractSpecies) with one call covering
 * up to `getBatchSize(lane)` papers at once — the lever for both "bulk" and
 * "fast" given NVIDIA's free-tier rate limit forces every call through a
 * single serialized slot per lane in llmClient.ts regardless of payload size
 * (see MAX_CONCURRENT_LLM_CALLS there). Batch size is adaptive per lane:
 * grows on sustained clean responses, shrinks on any sign of degradation —
 * see getBatchSize/recordBatchOutcome in llmClient.ts.
 *
 * When a second lane (deepseek) is configured alongside the primary one
 * (llama), this splits `papers` round-robin across every available lane and
 * runs each lane's own batch loop concurrently — two independent rate-limit
 * windows working through different halves of the paper list at once,
 * instead of one model serializing through all of them. With only one lane
 * configured this is identical to the single-lane loop it replaced.
 */
export async function runBatchedExtraction(
  papers: BatchExtractionInput[],
  region: string,
  taxonGroup: string,
): Promise<Map<string, BatchExtractionResult>> {
  const results = new Map<string, BatchExtractionResult>();
  if (papers.length === 0) return results;

  if (!isLlmEnabled()) {
    for (const paper of papers) results.set(paper.slug, fallbackResult(paper, region, taxonGroup));
    return results;
  }

  const lanes = availableLanes();
  const papersByLane = new Map<LlmLane, BatchExtractionInput[]>(lanes.map((lane) => [lane, []]));
  papers.forEach((paper, i) => papersByLane.get(lanes[i % lanes.length])!.push(paper));

  await Promise.all(
    lanes.map(async (lane) => {
      const lanePapers = papersByLane.get(lane)!;
      let cursor = 0;
      while (cursor < lanePapers.length) {
        const size = Math.max(1, Math.min(getBatchSize(lane), lanePapers.length - cursor));
        const chunk = lanePapers.slice(cursor, cursor + size);
        cursor += size;
        const chunkResults = await extractChunk(chunk, region, taxonGroup, lane);
        for (const [slug, result] of chunkResults) results.set(slug, result);
      }
    }),
  );
  return results;
}

/** Total prompt content is capped (~24k chars) regardless of batch size — larger batches get a smaller per-paper slice rather than an ever-growing prompt, with a floor so even a big batch keeps enough text per paper to be useful. */
function perPaperCharBudget(batchSize: number): number {
  return Math.max(1200, Math.floor(24000 / Math.max(1, batchSize)));
}

function buildPrompt(items: Array<{ id: string; title: string; text: string }>, region: string, taxonGroup: string): string {
  return [
    `Region of interest: "${region}"`,
    `Taxon group of interest: "${taxonGroup}"`,
    `You are given ${items.length} document(s) below, each with an "id". For EACH document, independently and using ONLY that document's own text (never another document's, never general knowledge):`,
    `1. documentType: exactly one of "checklist" (a species checklist, faunal/floral survey, or biodiversity inventory), "scientific_paper" (a normal peer-reviewed research paper not primarily a checklist), or "other".`,
    `2. semanticRanking (0-100): overall relevance/importance of this document for understanding species in this region+taxon.`,
    `3. regionRelevance (0-100): does it actually concern "${region}" specifically, not just a similarly-named or broader/nearby place?`,
    `4. taxonRelevance (0-100): does it actually concern "${taxonGroup}" specifically?`,
    `5. historicalImportance (0-100): how significant a historical record is it for this region's literature (older foundational surveys score higher)?`,
    `6. species: scientific (binomial) names of ${taxonGroup} species explicitly mentioned in THAT document's text. Do NOT add species from general knowledge and do NOT borrow species from a different document in this batch — only names that literally appear in the given document's own text. If none, use an empty array. For each species include: commonName (or null), occurrence (e.g. "resident"/"migrant"/"vagrant"/"historical_record" — only if stated or clearly implied, else null), location (a stated locality, or null), dateRange ({"from","to"} as stated, or null), and sourceSentence (the exact sentence it was mentioned in, for audit).`,
    ``,
    `Respond with ONLY a JSON array, exactly one element per input document, shaped exactly as:`,
    `{ "id": string, "documentType": "checklist"|"scientific_paper"|"other", "semanticRanking": number, "regionRelevance": number, "taxonRelevance": number, "historicalImportance": number, "species": [{ "scientificName": string, "commonName": string|null, "occurrence": string|null, "location": string|null, "dateRange": {"from": string|null, "to": string|null}|null, "sourceSentence": string }] }`,
    ``,
    `Documents:`,
    JSON.stringify(items),
  ].join("\n");
}

function normalizeResult(slug: string, raw: RawBatchItem, taxonGroup: string): BatchExtractionResult {
  const rawSpecies = Array.isArray(raw.species) ? raw.species : [];
  const candidates = rawSpecies
    .filter((item): item is RawSpeciesItem & { scientificName: string } => typeof item?.scientificName === "string" && item.scientificName.trim().length > 0)
    .map((item) => ({
      scientificName: item.scientificName.trim(),
      commonName: item.commonName ?? undefined,
      occurrence: item.occurrence ?? undefined,
      location: item.location ?? undefined,
      dateRange: item.dateRange && (item.dateRange.from || item.dateRange.to)
        ? { from: item.dateRange.from ?? undefined, to: item.dateRange.to ?? undefined }
        : undefined,
      sourceSentence: item.sourceSentence,
    }));

  const backboneMatches = matchAgainstBackbone(candidates.map((c) => c.scientificName), taxonGroup);
  const species: ExtractedSpeciesRecord[] = candidates.map((c) => {
    const match = backboneMatches.get(c.scientificName);
    return { ...c, scientificName: match?.scientificName ?? c.scientificName, backboneValidated: Boolean(match) };
  });

  const documentType: DocumentType =
    raw.documentType === "checklist" || raw.documentType === "scientific_paper" || raw.documentType === "other"
      ? raw.documentType
      : "other";

  return {
    slug,
    documentType,
    semanticRanking: typeof raw.semanticRanking === "number" ? raw.semanticRanking : 50,
    regionRelevance: typeof raw.regionRelevance === "number" ? raw.regionRelevance : 50,
    taxonRelevance: typeof raw.taxonRelevance === "number" ? raw.taxonRelevance : 50,
    historicalImportance: typeof raw.historicalImportance === "number" ? raw.historicalImportance : 0,
    species,
  };
}

function fallbackResult(paper: BatchExtractionInput, region: string, taxonGroup: string): BatchExtractionResult {
  const checklistVerdict = heuristicChecklistVerdict({ title: paper.title, abstract: paper.abstract });
  const heuristicText = `${paper.title} ${paper.fullText ?? paper.abstract ?? ""}`;
  const relevance = heuristicRelevanceVerdict(heuristicText, region, taxonGroup);
  return {
    slug: paper.slug,
    documentType: checklistVerdict.documentType,
    semanticRanking: relevance.semanticRanking,
    regionRelevance: relevance.regionRelevance,
    taxonRelevance: relevance.taxonRelevance,
    historicalImportance: relevance.historicalImportance,
    species: [],
  };
}

async function extractChunk(
  chunk: BatchExtractionInput[],
  region: string,
  taxonGroup: string,
  lane: LlmLane,
): Promise<Map<string, BatchExtractionResult>> {
  const result = new Map<string, BatchExtractionResult>();
  const perPaperChars = perPaperCharBudget(chunk.length);
  const items = chunk.map((p) => ({ id: p.slug, title: p.title, text: (p.fullText ?? p.abstract ?? "").slice(0, perPaperChars) }));
  const prompt = buildPrompt(items, region, taxonGroup);

  let parsed: RawBatchItem[] | null = null;
  try {
    const content = await callLlm(prompt, lane);
    parsed = extractJson<RawBatchItem[]>(content);
  } catch {
    parsed = null;
  }

  const bySlug = new Map(
    (Array.isArray(parsed) ? parsed : [])
      .filter((item): item is RawBatchItem & { id: string } => typeof item?.id === "string")
      .map((item) => [item.id, item] as const),
  );
  const missing = chunk.filter((p) => !bySlug.has(p.slug));
  const clean = parsed !== null && missing.length === 0;
  recordBatchOutcome(clean, lane);

  for (const paper of chunk) {
    const raw = bySlug.get(paper.slug);
    if (raw) result.set(paper.slug, normalizeResult(paper.slug, raw, taxonGroup));
  }

  if (missing.length === 0) return result;

  // Per-paper fallback backstop for whatever the batch call didn't return —
  // not the common path, just a guard against losing data when a batch
  // comes back malformed/incomplete. A batch of one that still fails this
  // way gets the heuristic fallback rather than recursing forever.
  for (const paper of missing) {
    if (chunk.length === 1) {
      result.set(paper.slug, fallbackResult(paper, region, taxonGroup));
      continue;
    }
    const singleton = await extractChunk([paper], region, taxonGroup, lane);
    result.set(paper.slug, singleton.get(paper.slug) ?? fallbackResult(paper, region, taxonGroup));
  }

  return result;
}
