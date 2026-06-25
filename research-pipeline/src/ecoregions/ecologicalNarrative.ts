import { callLlm, isLlmEnabled } from "../analysis/llmClient.js";
import type { EcologicalProfile } from "../types.js";

/** Non-LLM fallback — built directly from the structured fields, so the pipeline never blocks on LLM availability (same convention as the app's selectHighValueDocuments falling back to a heuristic). */
function templatedNarrative(profile: EcologicalProfile): string {
  if (profile.ecoregions.length === 0) {
    return `No ecoregion overlap data is available for ${profile.regionName}.`;
  }
  const lines: string[] = [];
  lines.push(
    `${profile.regionName} overlaps ${profile.ecoregions.length} WWF terrestrial ecoregion${
      profile.ecoregions.length === 1 ? "" : "s"
    }. The dominant biome is ${profile.dominantBiome}, in the ${profile.dominantRealm} realm.`,
  );
  for (const eco of profile.ecoregions) {
    lines.push(
      `- ${eco.ecoName} (${eco.biomeName}, ${eco.realm}) covers approximately ${(eco.overlapFraction * 100).toFixed(
        1,
      )}% of the region's area.`,
    );
  }
  return lines.join("\n");
}

/**
 * Writes a plain-language ecological narrative strictly grounded in the
 * structured EcologicalProfile — the LLM is given ONLY this JSON and
 * instructed never to state a biome/habitat fact not derivable from it.
 * Direct continuation of the existing app's anti-fabrication convention
 * ("Do NOT add species from general knowledge — only names that literally
 * appear in the text") applied to a new domain. Falls back to a templated
 * narrative on any LLM failure or when the LLM is not configured.
 *
 * `options.allowLlm` (default true) lets a caller skip the LLM call
 * entirely and always use the templated narrative — the main Stage B
 * pipeline (runPipeline.ts) passes `false` by default since this call sat
 * in the "Analyzing Species" UI step, adding LLM rate-limit latency to a
 * step that's otherwise pure local GBIF backbone enrichment.
 * discovery/manualContribution.ts (a single deliberate user action, not a
 * bulk run) keeps the default.
 */
export async function generateEcologicalNarrative(
  profile: EcologicalProfile,
  options: { allowLlm?: boolean } = {},
): Promise<string> {
  if (options.allowLlm === false || !isLlmEnabled()) return templatedNarrative(profile);

  const prompt = [
    `Below is structured ecoregion-intersection data for the region "${profile.regionName}", computed by`,
    `intersecting its administrative boundary against the WWF Terrestrial Ecoregions of the World dataset.`,
    `Write a 2-3 paragraph plain-language summary of this region's habitat/biome characteristics.`,
    `Do NOT state any biome, climate, or habitat fact that is not derivable from the structured data below —`,
    `if the data is sparse, say so plainly rather than filling in from general knowledge.`,
    ``,
    JSON.stringify(profile, null, 2),
  ].join("\n");

  try {
    const content = await callLlm(prompt);
    return content.trim() || templatedNarrative(profile);
  } catch {
    return templatedNarrative(profile);
  }
}
