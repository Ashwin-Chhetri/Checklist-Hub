import { NextResponse } from "next/server";
import { searchLiterature } from "@/modules/evidence/discovery/literature/search";
import { rankDocuments } from "@/modules/evidence/discovery/literature/ranking";
import { extractSpeciesFromCandidates } from "@/modules/evidence/discovery/literature/binomialExtraction";
import { findPriorChecklists } from "@/modules/evidence/discovery/literature/priorChecklist";
import {
  extractSpeciesFromDocument,
  isExtractionEnabled,
  selectHighValueDocuments,
} from "@/modules/evidence/discovery/literature/llm";
import type { LiteratureResponse } from "@/modules/evidence/discovery/literature/types";

export type { LiteratureResponse, LiteratureDocument, LiteratureSpeciesCandidate } from "@/modules/evidence/discovery/literature/types";

// Literature evidence: searches OpenAlex, Crossref, Semantic Scholar, and
// (optionally) BHL for regional checklist/survey publications matching the
// taxon group + region, heuristically ranks them, and — only if
// ENABLE_LITERATURE_AGENT=true + NVIDIA_API_KEY are configured — uses an LLM
// to (1) select which of the real search results look like high-value
// checklist documents and (2) extract species names from those documents'
// text. The LLM never discovers literature itself.
export async function POST(request: Request) {
  const { taxonGroup, regionName } = (await request.json()) as {
    taxonGroup?: string;
    regionName?: string;
  };

  if (!taxonGroup || !regionName) {
    return NextResponse.json<LiteratureResponse>({
      query: "",
      documentsFound: 0,
      candidateDocuments: [],
      extractionEnabled: isExtractionEnabled(),
      selectedDocuments: [],
      species: [],
      priorChecklists: [],
    });
  }

  const query = `${taxonGroup} checklist ${regionName}`;
  const documents = await searchLiterature(taxonGroup, regionName);
  // Scan a much wider slice of ranked documents for binomial extraction —
  // with only title/abstract text available (no full-text fetch), each
  // document yields at most a handful of species, so capping at 10 starved
  // the fallback extractor for taxon groups with hundreds of species.
  const candidateDocuments = rankDocuments(documents, taxonGroup, regionName, 50);

  const extractionEnabled = isExtractionEnabled();
  let selectedDocuments: LiteratureResponse["selectedDocuments"] = [];
  let species: LiteratureResponse["species"] = [];
  let message: string | undefined;

  if (extractionEnabled) {
    selectedDocuments = await selectHighValueDocuments(candidateDocuments, taxonGroup, regionName);
    species = (await Promise.all(selectedDocuments.map((doc) => extractSpeciesFromDocument(doc, taxonGroup)))).flat();
    if (species.length === 0) {
      message = `Found ${candidateDocuments.length} candidate documents but no species could be extracted.`;
    }
  }

  // Fallback (and default) extraction: scan titles/abstracts for "Genus
  // species" binomials and keep only those that resolve to real
  // accepted/synonym species in the local GBIF backbone. Requires no API
  // keys, so literature contributes species even without LLM extraction.
  // Scans the *full* deduped document set, not just the top-50
  // candidateDocuments — ranking is a sort for display, not a discard
  // filter, so restricting extraction to the top 50 starved this fallback
  // when more than 50 documents were found.
  if (species.length === 0 && documents.length > 0) {
    species = extractSpeciesFromCandidates(documents, taxonGroup);
    if (species.length > 0) {
      message = `Found ${species.length} species mentioned across ${documents.length} candidate checklist/survey documents.`;
    }
  }

  if (species.length === 0) {
    message =
      candidateDocuments.length > 0
        ? `Found ${candidateDocuments.length} candidate checklist/survey documents but no species could be identified from them.`
        : `No candidate checklist/survey documents found for "${query}".`;
  }

  // Detect prior published checklists/surveys for this taxon group + region
  // — informational signal, scanned over the full document set (not just the
  // top-50 ranked candidates) so lower-ranked exact-title matches aren't missed.
  const priorChecklists = findPriorChecklists(documents, taxonGroup, regionName);
  const priorChecklistIds = new Set(priorChecklists.map((doc) => doc.id));
  const annotatedCandidateDocuments = candidateDocuments.map((doc) =>
    priorChecklistIds.has(doc.id) ? { ...doc, isLikelyExistingChecklist: true } : doc,
  );

  return NextResponse.json<LiteratureResponse>({
    query,
    documentsFound: annotatedCandidateDocuments.length,
    candidateDocuments: annotatedCandidateDocuments,
    extractionEnabled,
    selectedDocuments,
    species,
    priorChecklists,
    message,
  });
}
