import { getReferences, getCitations, type RelatedPaper } from "../sources/semanticScholar.js";
import { paperSlug } from "../corpus/paperSlug.js";
import { writeRawJson } from "../corpus/rawStore.js";
import type { PaperCandidate } from "../types.js";

export interface ExpansionSeed {
  slug: string;
  doi?: string;
}

function toCandidate(related: RelatedPaper, expandedFrom: string): PaperCandidate {
  return {
    slug: paperSlug({ doi: related.doi, title: related.title }),
    title: related.title,
    doi: related.doi,
    year: related.year,
    discoveredVia: "citation_expansion",
    expandedFrom,
  };
}

/**
 * Phase B discovery: one hop of references + citing papers via Semantic
 * Scholar's citation graph, for each seed paper. Captures the user's
 * "biggest concern" from plan iteration 3 — the most relevant literature for
 * a region sometimes never surfaces from a Scholar keyword search directly,
 * only by following what a directly-relevant paper cites or is cited by.
 *
 * Callers are expected to pass only seeds that already passed the LLM
 * relevance gate (see analysis/relevanceScoring.ts), to keep expansion
 * bounded rather than fanning out from every discovered paper. Seeds without
 * a DOI are skipped (citation-graph lookups require one) rather than failing
 * the run.
 */
export async function expandViaCitations(
  seeds: ExpansionSeed[],
  existingSlugs: Set<string>,
): Promise<PaperCandidate[]> {
  const expanded: PaperCandidate[] = [];
  const seen = new Set(existingSlugs);

  for (const seed of seeds) {
    if (!seed.doi) continue;

    const [references, citations] = await Promise.all([getReferences(seed.doi), getCitations(seed.doi)]);
    await writeRawJson(seed.slug, "citation_graph.json", { references, citations });

    for (const related of [...references, ...citations]) {
      if (!related.title) continue;
      const candidate = toCandidate(related, seed.slug);
      if (seen.has(candidate.slug)) continue;
      seen.add(candidate.slug);
      expanded.push(candidate);
    }
  }

  return expanded;
}
