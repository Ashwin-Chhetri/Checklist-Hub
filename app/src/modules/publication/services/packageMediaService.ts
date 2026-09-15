import type { Species } from "@/types/species.types";
import type { SpeciesMediaItem } from "@/app/api/taxonomy/species-media/route";

const BATCH_SIZE = 5;

async function fetchMediaForTaxon(taxonKey: number): Promise<SpeciesMediaItem[]> {
  const response = await fetch(`/api/taxonomy/species-media?taxonKey=${taxonKey}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.media ?? [];
}

/**
 * Fetches real GBIF media for every species with a resolved `gbif_taxon_key`,
 * in small concurrent batches (the existing `/api/taxonomy/species-media`
 * route already calls GBIF's own media API — this just reuses it across a
 * whole checklist instead of one taxon at a time). Species with no taxon key
 * or no GBIF media simply have no entry in the returned map.
 */
export async function fetchSpeciesMediaMap(
  species: Species[],
  // `partial` is the same map being built, handed over read-only at each
  // tick so a caller can render a live-filling multimedia.txt instead of a
  // static file until the whole fetch finishes — safe to read synchronously
  // in the callback since nothing mutates it again until the next tick.
  onProgress?: (done: number, total: number, partial: ReadonlyMap<string, SpeciesMediaItem[]>) => void,
): Promise<Map<string, SpeciesMediaItem[]>> {
  const targets = species.filter((s) => s.gbif_taxon_key != null);
  const result = new Map<string, SpeciesMediaItem[]>();
  let done = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const mediaLists = await Promise.all(batch.map((s) => fetchMediaForTaxon(s.gbif_taxon_key as number)));
    batch.forEach((s, idx) => {
      if (mediaLists[idx].length > 0) result.set(s.id, mediaLists[idx]);
    });
    done += batch.length;
    onProgress?.(done, targets.length, result);
  }

  return result;
}
