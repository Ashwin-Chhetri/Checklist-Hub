import type { EvidenceQuality, SpeciesEvidence, SpeciesEvidenceSource } from "@/types/species.types";

const BASE_SCORE: Record<SpeciesEvidenceSource["source"], number> = {
  literature: 3,
  ebird: 3,
  gbif: 2,
  inaturalist: 2,
  legacy: 0,
};

function occurrenceTier(count: number): number {
  if (count > 100) return 2;
  if (count > 20) return 1;
  return 0;
}

export function computeEvidenceScore(
  evidence: SpeciesEvidence | undefined,
  taxonClass: string | null | undefined,
): number {
  const isAves = taxonClass?.toLowerCase() === "aves";
  const activeSources = (evidence?.sources ?? []).filter((s) => s.status !== "discarded");

  let score = 0;
  let contributingCount = 0;
  for (const s of activeSources) {
    if (s.source === "ebird" && !isAves) continue; // eBird is only meaningful evidence for birds
    score += BASE_SCORE[s.source] + occurrenceTier(s.record_count ?? 0);
    contributingCount += 1;
  }
  if (contributingCount > 1) score += contributingCount - 1; // +1 per independent source beyond the first

  return score;
}

export function evidenceScoreToQuality(score: number): EvidenceQuality {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export function computeEvidenceQuality(
  evidence: SpeciesEvidence | undefined,
  taxonClass: string | null | undefined,
): EvidenceQuality {
  return evidenceScoreToQuality(computeEvidenceScore(evidence, taxonClass));
}
