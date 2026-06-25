export interface GreySignalVerdict {
  credible: boolean;
  reasons: string[];
}

const INSTITUTIONAL_URL_HINTS = [".gov", ".ac.", ".edu", "researchgate.net", "academia.edu"];
const QUALITY_HOST_HINTS = ["core.ac.uk", "zenodo.org", "biodiversitylibrary.org"];

/**
 * Grading axis (c): for documents classified as "other" (non-scientific),
 * a conservative, never-a-hard-filter credibility check — flags reasons
 * rather than just discarding, per the original requirement: "if its non
 * scientific paper but has relevant values." Always returns reasons so the
 * wiki/report can show *why* it was flagged either way.
 */
export function assessGreyLiteratureCredibility(input: {
  title: string;
  url?: string;
  venue?: string;
  year?: number;
  authors?: string;
}): GreySignalVerdict {
  const reasons: string[] = [];
  let score = 0;

  const url = (input.url ?? "").toLowerCase();
  if (INSTITUTIONAL_URL_HINTS.some((hint) => url.includes(hint))) {
    score += 1;
    reasons.push("Hosted on an institutional/academic domain.");
  }
  if (QUALITY_HOST_HINTS.some((hint) => url.includes(hint))) {
    score += 1;
    reasons.push("Hosted on a recognized repository (CORE/Zenodo/BHL).");
  }
  if (input.year) {
    score += 1;
    reasons.push("Has a publication year.");
  }
  if (input.authors) {
    score += 1;
    reasons.push("Has identifiable author(s).");
  }
  if (input.venue) {
    score += 1;
    reasons.push("Has a venue/publisher.");
  }

  if (reasons.length === 0) reasons.push("No institutional, authorship, or venue signal found.");

  return { credible: score >= 2, reasons };
}
