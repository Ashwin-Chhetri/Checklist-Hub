import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import type { ReviewCandidate } from "../types.js";

function reviewPath(runId: string): string {
  return path.join(paths.raw, "runs", `${runId}-candidates.json`);
}

/** Written once, at the end of the discovery phase — the full pre-fulltext review pool for this run (see RunPhase's "awaiting_review" doc comment). */
export async function writeReviewCandidates(runId: string, candidates: ReviewCandidate[]): Promise<void> {
  await fs.mkdir(path.dirname(reviewPath(runId)), { recursive: true });
  await fs.writeFile(reviewPath(runId), JSON.stringify(candidates, null, 2));
}

export async function readReviewCandidates(runId: string): Promise<ReviewCandidate[]> {
  try {
    const raw = await fs.readFile(reviewPath(runId), "utf8");
    return JSON.parse(raw) as ReviewCandidate[];
  } catch {
    return [];
  }
}

/** Toggles a candidate's user-curation flag in place — see ReviewCandidate.excluded. Returns null if the run or the slug within it doesn't exist. */
export async function setReviewCandidateExcluded(runId: string, slug: string, excluded: boolean): Promise<ReviewCandidate | null> {
  const candidates = await readReviewCandidates(runId);
  const candidate = candidates.find((c) => c.metadata.slug === slug);
  if (!candidate) return null;
  candidate.excluded = excluded;
  await writeReviewCandidates(runId, candidates);
  return candidate;
}
