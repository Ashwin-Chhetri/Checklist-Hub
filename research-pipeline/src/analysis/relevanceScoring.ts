import { checkRegionSpecificity } from "./regionSpecificity.js";
import { checkTaxonSpecificity } from "./taxonSpecificity.js";

export interface RelevanceVerdict {
  /** 0-100: how relevant/important this document is overall for the region+taxon, considering everything (responsibility #1: semantic ranking). */
  semanticRanking: number;
  /** 0-100: does this document actually concern the region of interest, as opposed to a similarly-named or nearby region (responsibility #2). */
  regionRelevance: number;
  /** 0-100: does this document actually concern the taxon group of interest (responsibility #3). */
  taxonRelevance: number;
  /** 0-100: how historically significant this document is for the region's literature record — older foundational surveys score higher (responsibility #4). */
  historicalImportance: number;
  reasons: string[];
}

/**
 * Heuristic fallback used when no LLM is configured — this used to be a
 * flat 50/50 for every document, which caused two real reported problems:
 * (1) a user asking for "Aves in Darjeeling" got general "birds of West
 * Bengal" results mixed in indistinguishably (fixed via
 * regionSpecificity.ts), and (2) a moth checklist got selected as the
 * "most recent checklist" for an Aves search, since nothing distinguished
 * documents actually about the right taxon group from ones that just
 * happened to match the region/checklist search terms (fixed here via
 * taxonSpecificity.ts). Only semanticRanking/historicalImportance stay
 * neutral defaults, since those genuinely need judgment an LLM provides.
 */
export function heuristicRelevanceVerdict(text: string, regionName: string, taxonGroup: string): RelevanceVerdict {
  const region = checkRegionSpecificity(text, regionName);
  const taxon = checkTaxonSpecificity(text, taxonGroup);
  return {
    semanticRanking: 50,
    regionRelevance: region.score,
    taxonRelevance: taxon.score,
    historicalImportance: 0,
    reasons: [region.reason, taxon.reason, "LLM unavailable — semanticRanking/historicalImportance are neutral defaults."],
  };
}
