/**
 * Server-only: loads app/data/higher-rank-vernacular.json (built by
 * scripts/build-higher-rank-vernacular.mjs) — an English vernacular-name ->
 * classification index covering every kingdom/phylum/class/order in the
 * GBIF backbone. See that script's header comment for why this exists
 * separately from the species-only local mirror.
 */
import fs from "node:fs";
import path from "node:path";
import type { TaxonomicScope } from "@/types/checklist.types";

const DATA_PATH = path.join(process.cwd(), "data", "higher-rank-vernacular.json");

let index: Record<string, TaxonomicScope> | null = null;
let loadAttempted = false;

function loadIndex(): Record<string, TaxonomicScope> {
  if (loadAttempted) return index ?? {};
  loadAttempted = true;
  try {
    index = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch (err) {
    console.error("[higherRankVernacular] failed to load higher-rank-vernacular.json:", err);
    index = {};
  }
  return index ?? {};
}

export function matchHigherRankVernacular(name: string): TaxonomicScope | null {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;
  return loadIndex()[trimmed] ?? null;
}
