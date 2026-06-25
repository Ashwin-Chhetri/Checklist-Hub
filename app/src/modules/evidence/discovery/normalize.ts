import type { NormalizeInput, NormalizeResult } from "@/app/api/taxonomy/normalize/route";

/**
 * Client wrapper around /api/taxonomy/normalize. Resolves a batch of names /
 * GBIF keys to accepted backbone taxa (synonyms followed to their accepted
 * usage). Chunked so a large inventory doesn't build one oversized POST body.
 */
export async function normalizeBatch(
  items: NormalizeInput[],
  kingdomHint?: string,
): Promise<Map<string, NormalizeResult>> {
  const out = new Map<string, NormalizeResult>();
  if (items.length === 0) return out;

  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    let results: NormalizeResult[] = [];
    try {
      const response = await fetch("/api/taxonomy/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chunk, kingdomHint }),
      });
      if (response.ok) {
        results = ((await response.json()) as { results: NormalizeResult[] }).results;
      }
    } catch {
      // Network/route failure ⇒ leave this chunk unresolved; callers degrade.
    }
    for (const result of results) out.set(result.id, result);
  }

  return out;
}

export type { NormalizeInput, NormalizeResult };
