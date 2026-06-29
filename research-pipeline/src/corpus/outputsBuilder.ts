import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { listCatalogEntries } from "./catalogBuilder.js";
import { readRawJson, readLatestLlmAnalysis } from "./rawStore.js";
import type { LlmAnalysis, PaperMetadata } from "../types.js";

async function writeOutput(filename: string, data: unknown): Promise<void> {
  await fs.mkdir(paths.outputs, { recursive: true });
  await fs.writeFile(path.join(paths.outputs, filename), JSON.stringify(data, null, 2));
}

/**
 * Regenerates the cross-paper derived JSON artifacts in outputs/ from the
 * whole corpus (catalog/ + raw/ analysis snapshots) — these are the "fast
 * retrieval artifacts for ChecklistHub" the plan calls out as the eventual
 * integration surface, though no integration happens here (no Supabase
 * writes — see README "Design notes").
 */
export async function buildOutputs(): Promise<void> {
  // User-excluded documents (see CatalogEntry.excluded) never feed these
  // cross-paper aggregates — raw/ keeps the evidence, but a paper the user
  // explicitly removed from a region+taxon's listing shouldn't still
  // surface its species/coordinates/ranking here. Region-"unverified"
  // entries (no full text resolved, so analysis/regionContainment.ts never
  // got to confirm/deny — see runPipeline.ts) are excluded from the species
  // aggregate specifically (not from the document-level artifacts below):
  // an abstract-only paper that's only loosely keyword-matched to begin
  // with is exactly the kind of source that was inflating species counts
  // well past a region's real checklist size with mentions never confirmed
  // to actually be about this region.
  const entries = (await listCatalogEntries()).filter((e) => !e.excluded);
  const speciesEligibleEntries = entries.filter((e) => e.regionContainment !== "unverified");
  const details = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      metadata: await readRawJson<PaperMetadata>(entry.slug, "metadata.json"),
      analysis: await readLatestLlmAnalysis<LlmAnalysis>(entry.slug),
    })),
  );
  const speciesEligibleSlugs = new Set(speciesEligibleEntries.map((e) => e.slug));

  const speciesMap = new Map<
    string,
    {
      scientificName: string;
      commonName?: string;
      sources: Array<{ slug: string; title: string; citation?: string }>;
      coordinates: Array<{ lat: number; lng: number }>;
      dateRanges: Array<{ from?: string; to?: string }>;
      /** True if flagged by the final review pass (analysis/finalReviewPass.ts) in ANY contributing source — advisory only. */
      flagged: boolean;
    }
  >();
  for (const d of details) {
    if (!speciesEligibleSlugs.has(d.entry.slug)) continue;
    for (const sp of d.analysis?.species ?? []) {
      // Dedup key: the GBIF-resolved accepted name when this name is a
      // known synonym (analysis/gbifEnrichment.ts's acceptedScientificName),
      // falling back to the extracted name otherwise. Trinomial/subspecies
      // extractions already collapse to their parent binomial at match time
      // (backboneMatch.ts's subspecies fallback), so no extra handling is
      // needed for those here — only synonym->accepted resolution was being
      // silently discarded by keying on the raw extracted string.
      const key = sp.acceptedScientificName ?? sp.scientificName;
      const existing = speciesMap.get(key) ?? {
        scientificName: key,
        commonName: sp.commonName ?? sp.backboneCommonName,
        sources: [],
        coordinates: [],
        dateRanges: [],
        flagged: false,
      };
      existing.sources.push({ slug: d.entry.slug, title: d.entry.title, citation: d.entry.citation });
      if (sp.dateRange?.from || sp.dateRange?.to) existing.dateRanges.push(sp.dateRange);
      if (sp.flagged) existing.flagged = true;
      for (const coord of d.analysis?.coordinates ?? []) {
        if (coord.species === sp.scientificName && !coord.outOfRangeSuspect) {
          existing.coordinates.push({ lat: coord.lat, lng: coord.lng });
        }
      }
      speciesMap.set(key, existing);
    }
  }

  const importantPapers = [...details]
    .sort((a, b) => (b.entry.llm_relevance ?? 0) - (a.entry.llm_relevance ?? 0))
    .slice(0, 50)
    .map((d) => ({
      slug: d.entry.slug,
      title: d.entry.title,
      doi: d.entry.doi,
      citation: d.entry.citation,
      relevance: d.entry.llm_relevance,
    }));

  const historicalChecklists = details
    .filter((d) => d.entry.historical && d.analysis?.isChecklist)
    .map((d) => ({ slug: d.entry.slug, title: d.entry.title, year: d.metadata?.year, doi: d.entry.doi, citation: d.entry.citation }));

  const coordinates = details.flatMap((d) =>
    (d.analysis?.coordinates ?? [])
      .filter((c) => !c.outOfRangeSuspect)
      .map((c) => ({ paperSlug: d.entry.slug, species: c.species, lat: c.lat, lng: c.lng })),
  );

  const literatureRankings = [...details]
    .sort((a, b) => (b.entry.llm_relevance ?? 0) - (a.entry.llm_relevance ?? 0))
    .map((d) => ({
      slug: d.entry.slug,
      title: d.entry.title,
      citation: d.entry.citation,
      relevance: d.entry.llm_relevance,
      documentType: d.entry.documentType,
      greySignalCredible: d.entry.greySignalCredible,
      region: d.entry.region,
      taxa: d.entry.taxa,
      flagged: d.entry.flagged,
      flagReason: d.entry.flagReason,
    }));

  await Promise.all([
    writeOutput("species.json", [...speciesMap.values()]),
    writeOutput("important_papers.json", importantPapers),
    writeOutput("historical_checklists.json", historicalChecklists),
    writeOutput("coordinates.json", coordinates),
    writeOutput("literature_rankings.json", literatureRankings),
  ]);
}
