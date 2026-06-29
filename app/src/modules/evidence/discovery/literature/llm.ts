import type { LiteratureDocument, LiteratureSpeciesCandidate } from "./types";

const NVIDIA_API = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.1-70b-instruct";

/** True when the LLM ranking/extraction steps are configured and enabled. */
export function isExtractionEnabled(): boolean {
  return process.env.ENABLE_LITERATURE_AGENT === "true" && Boolean(process.env.NVIDIA_API_KEY);
}

/** Pulls the first JSON array out of an LLM response that may wrap it in prose/fences. */
function extractJsonArray(content: string): unknown[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

async function callNvidia(prompt: string): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY;
  const response = await fetch(NVIDIA_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "[]";
}

/**
 * Asks the LLM to select which of the heuristically-ranked candidate
 * documents look like genuine regional checklist/survey publications (as
 * opposed to merely topically-related papers). Falls back to the heuristic
 * top 3 on any LLM/parse failure. Never invents new documents — only selects
 * from `candidates`.
 */
export async function selectHighValueDocuments(
  candidates: LiteratureDocument[],
  taxonGroup: string,
  regionName: string,
): Promise<LiteratureDocument[]> {
  const fallback = candidates.slice(0, 3);
  if (candidates.length === 0) return [];

  const listing = candidates
    .map((doc, i) => `${i}. "${doc.title}" (${doc.year ?? "n.d."})${doc.abstract ? ` — ${doc.abstract.slice(0, 400)}` : ""}`)
    .join("\n");

  const prompt = [
    `Below is a numbered list of publications found via literature search for "${taxonGroup}" in "${regionName}".`,
    `Identify which of these are genuine regional species checklists, faunal/floral surveys, or biodiversity inventories`,
    `for this taxon group and region (not just topically-related papers).`,
    `Respond with ONLY a JSON array of the indices (numbers) of the high-value documents, e.g. [0, 2]. Select at most 5. If none qualify, respond with [].`,
    ``,
    listing,
  ].join("\n");

  try {
    const content = await callNvidia(prompt);
    const indices = extractJsonArray(content).filter((i): i is number => typeof i === "number");
    const selected = indices.map((i) => candidates[i]).filter((d): d is LiteratureDocument => Boolean(d));
    return selected.length > 0 ? selected.slice(0, 5) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Asks the LLM to extract scientific names mentioned in a document's
 * title/abstract. Extraction only — the LLM must not fabricate species not
 * present in the text. Returns [] on any failure or when nothing is found.
 */
export async function extractSpeciesFromDocument(
  doc: LiteratureDocument,
  taxonGroup: string,
): Promise<LiteratureSpeciesCandidate[]> {
  const text = [doc.title, doc.abstract].filter(Boolean).join("\n\n");
  if (!text.trim()) return [];

  const prompt = [
    `Extract scientific (binomial) names of ${taxonGroup} species that are explicitly mentioned in the text below.`,
    `Do NOT add species from general knowledge — only names that literally appear in the text.`,
    `If no species names are present, respond with [].`,
    `Respond with ONLY a JSON array of objects: { "scientific_name": string, "common_name": string|null }.`,
    ``,
    text,
  ].join("\n");

  try {
    const content = await callNvidia(prompt);
    const parsed = extractJsonArray(content) as Array<{ scientific_name?: string; common_name?: string | null }>;
    return parsed
      .filter((item) => typeof item.scientific_name === "string" && item.scientific_name.trim())
      .map((item) => ({
        scientificName: item.scientific_name!.trim(),
        commonName: item.common_name ?? undefined,
        sourceDocument: { title: doc.title, doi: doc.doi, url: doc.url, year: doc.year },
      }));
  } catch {
    return [];
  }
}
