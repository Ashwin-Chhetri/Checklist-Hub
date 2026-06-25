import { checkRegionSpecificity } from "./regionSpecificity.js";
import { checkTaxonSpecificity } from "./taxonSpecificity.js";
import { heuristicChecklistVerdict } from "./checklistDetection.js";
import { assessGreyLiteratureCredibility } from "./greyLiteratureSignal.js";
import { checkSpeciesRecordSignal } from "./speciesRecordSignal.js";
import { checkAccessibilitySignal } from "./accessibilitySignal.js";
import type { DocumentType } from "../types.js";

export interface PreliminaryRelevance {
  /** 0-100 combined score — what the review pool ranks/filters by before any full-text fetch or LLM call happens. */
  score: number;
  regionScore: number;
  taxonScore: number;
  documentType: DocumentType;
  /** True for checklist/scientific_paper, or "other" documents with a credible grey-lit signal — the thing a checklist can actually cite. */
  citable: boolean;
  greySignalCredible?: boolean;
  /** 0-100: does this look like actual species-record literature (checklist/survey/specimen language, binomial mentions) vs. region/taxon keywords showing up incidentally in unrelated content (e.g. a tourism book) — see speciesRecordSignal.ts. */
  speciesRecordScore: number;
  /** 0-100: cheap, network-free estimate of whether we can actually obtain full text for this — see accessibilitySignal.ts. Real OA resolution still only happens in Stage B; this just keeps known-inaccessible sources from outranking accessible ones during discovery. */
  accessibilityScore: number;
  reasons: string[];
}

/**
 * Combines region-specificity + taxon-specificity + "is this actually
 * something citable" (document type, falling back to the grey-literature
 * credibility heuristic for non-scientific documents) into one ranking
 * score — entirely from metadata (title/abstract/venue/url/year/authors),
 * no full text or LLM call required. This is what the review pool (Stage A,
 * before the pipeline pauses for the user) ranks and filters by: the user
 * explicitly asked for quality over volume — "Scientific Paper, book
 * publication, articles... things that can be cited in a checklist" — not
 * just whatever a keyword search happened to surface.
 *
 * Weighted region/taxon highest (0.3/0.3), then citability/species-record
 * content/accessibility (0.15 each): a perfectly citable paper about the
 * wrong place or the wrong taxon is still useless, but among documents that
 * already pass region+taxon, the remaining three dimensions catch the
 * cases region+taxon keyword matching alone cannot — content (a tourism
 * book like "A Summer Place" mentions the region and incidentally some
 * birds, but isn't species-record literature), and accessibility (a source
 * we have no real way to ever read shouldn't outrank one we can actually
 * extract from, per the explicit "discovering without means to read is not
 * a good idea" requirement).
 */
export function scorePreliminaryRelevance(
  metadata: {
    title: string;
    abstract?: string;
    venue?: string;
    url?: string;
    year?: number;
    authors?: string;
    doi?: string;
    isOa?: boolean;
    oaUrl?: string;
  },
  region: string,
  taxonGroup: string,
  /** The target region's own country, resolved once per run from its geocoded boundary (see pipeline/runPipeline.ts) — lets checkRegionSpecificity's wrong-country detector exclude it dynamically instead of guessing/hardcoding one country, so this generalizes to a region in any country, not just the one this feature was originally debugged against. Optional: when boundary resolution fails, the wrong-country check still runs, just without that one extra exclusion. */
  ownCountryHint?: string,
): PreliminaryRelevance {
  const text = `${metadata.title} ${metadata.abstract ?? ""}`;
  const regionMatch = checkRegionSpecificity(text, region, ownCountryHint);
  const taxonMatch = checkTaxonSpecificity(text, taxonGroup);
  const checklistVerdict = heuristicChecklistVerdict({ title: metadata.title, venue: metadata.venue, abstract: metadata.abstract });
  const speciesRecordMatch = checkSpeciesRecordSignal(text);
  const accessibilityMatch = checkAccessibilitySignal({
    doi: metadata.doi,
    url: metadata.url,
    isOa: metadata.isOa,
    oaUrl: metadata.oaUrl,
  });

  const reasons = [
    regionMatch.reason,
    taxonMatch.reason,
    ...checklistVerdict.reasons,
    ...speciesRecordMatch.reasons,
    ...accessibilityMatch.reasons,
  ];

  let citabilityScore: number;
  let citable: boolean;
  let greySignalCredible: boolean | undefined;
  if (checklistVerdict.documentType === "checklist" || checklistVerdict.documentType === "scientific_paper") {
    citabilityScore = 100;
    citable = true;
  } else {
    const grey = assessGreyLiteratureCredibility({
      title: metadata.title,
      url: metadata.url,
      venue: metadata.venue,
      year: metadata.year,
      authors: metadata.authors,
    });
    greySignalCredible = grey.credible;
    citable = grey.credible;
    citabilityScore = grey.credible ? 55 : 15;
    reasons.push(...grey.reasons);
  }

  let score = Math.round(
    regionMatch.score * 0.3 +
      taxonMatch.score * 0.3 +
      citabilityScore * 0.15 +
      speciesRecordMatch.score * 0.15 +
      accessibilityMatch.score * 0.1,
  );

  // Hard cap, not just a weighted-in penalty: region+taxon keyword overlap
  // alone is worth 0.6 combined weight, which was otherwise enough to carry
  // a tourism book (mentions the region, mentions birds in passing) over
  // the review threshold regardless of how strongly tourism language
  // dominated — the real "A Summer Place" bug. Capped below
  // REVIEW_SCORE_THRESHOLD (70) so it never survives into the review pool
  // on region/taxon overlap alone.
  if (speciesRecordMatch.strongTourismSignal) {
    score = Math.min(score, 40);
  }

  // Same hard-cap pattern, for the real "Darjeeling search returns Nepal/
  // Argentina papers" bug: a high taxon/citability/species-record score
  // (a perfectly good, citable bird paper — just about the wrong country)
  // was otherwise enough on its own to clear REVIEW_SCORE_THRESHOLD (70)
  // once region's neutral "uncertain" score got weighted in at only 0.3.
  // checkRegionSpecificity's wrongCountrySignal is a much stronger claim
  // than "uncertain" — the text explicitly names a different country and
  // never mentions the target region at all — so this caps well below the
  // threshold regardless of how strong the other four dimensions look.
  if (regionMatch.wrongCountrySignal) {
    score = Math.min(score, 30);
  }

  // Same hard-cap pattern as wrongCountrySignal, one tier up — for the real
  // "Nainital/Uttarakhand cleared a Darjeeling, West Bengal search" bug:
  // mentioning only the country (not the actual state/province, and
  // definitely not the specific district) is barely stronger evidence than
  // mentioning nothing at all, yet at the old undifferentiated "broader
  // area" score (25 * 0.3 = 7.5) a strong taxon/citability/species-record/
  // accessibility paper could still average up past 70. Capped just below
  // the no-taxon-match cap (35) so a country-only match never single-
  // handedly carries an otherwise-unrelated-district paper over the line.
  if (regionMatch.countryOnlySignal) {
    score = Math.min(score, 35);
  }

  // Mirror-image bug, found via a real multi-region/multi-taxon test run: a
  // veterinary-parasitology paper ("soil-transmitted nematodes in Kandy")
  // scored region=85 (it genuinely is about Kandy) with taxon=30 (zero
  // mention of birds/Aves) and still cleared 70, because a strong region
  // match alone (0.3 weight) was enough to carry a paper with literally no
  // taxon evidence once citability/species-record/accessibility stacked on
  // top. Same fix as the region-side hard caps above, on the other axis:
  // checkTaxonSpecificity's no-match floor is 30 (its only two possible
  // outputs are 85 or 30, see taxonSpecificity.ts) — at that floor there is
  // zero positive evidence this document concerns the requested taxon
  // group at all, so it's capped below threshold regardless of how
  // strongly everything else (including the correct region) looks.
  if (taxonMatch.score <= 30) {
    score = Math.min(score, 35);
  }

  // checkTaxonSpecificity's wrongTaxonSignal (a real validated species of a
  // DIFFERENT class/order found in the text, despite a synonym word match)
  // is even stronger evidence than the floor case above — same cap level
  // as wrongCountrySignal for the same reason: a confirmed mismatch, not
  // just an absence of evidence.
  if (taxonMatch.wrongTaxonSignal) {
    score = Math.min(score, 30);
  }

  return {
    score,
    regionScore: regionMatch.score,
    taxonScore: taxonMatch.score,
    documentType: checklistVerdict.documentType,
    citable,
    greySignalCredible,
    speciesRecordScore: speciesRecordMatch.score,
    accessibilityScore: accessibilityMatch.score,
    reasons,
  };
}
