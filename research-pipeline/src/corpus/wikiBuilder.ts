import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { regionTaxonSlug } from "./paperSlug.js";
import { readRawJson, readLatestLlmAnalysis } from "./rawStore.js";
import { formatApaCitation } from "./citationFormatter.js";
import type { CatalogEntry, LlmAnalysis, PaperMetadata } from "../types.js";

interface WikiInput {
  region: string;
  taxonGroup: string;
  entries: CatalogEntry[];
}

async function loadDetails(entries: CatalogEntry[]): Promise<Array<{ entry: CatalogEntry; metadata: PaperMetadata | null; analysis: LlmAnalysis | null }>> {
  return Promise.all(
    entries.map(async (entry) => ({
      entry,
      metadata: await readRawJson<PaperMetadata>(entry.slug, "metadata.json"),
      analysis: await readLatestLlmAnalysis<LlmAnalysis>(entry.slug),
    })),
  );
}

/** Prefers the catalog entry's precomputed APA citation (catalog/ is always rebuilt fresh); falls back to formatting from metadata directly for entries written before `citation` existed on CatalogEntry. */
function citation(metadata: PaperMetadata | null, entry: CatalogEntry): string {
  if (entry.citation) return entry.citation;
  if (!metadata) return entry.title;
  return formatApaCitation(metadata);
}

/**
 * Regenerates the whole wiki/<Region + Taxon>/ directory each run — "wiki
 * may be rewritten repeatedly," per the plan, unlike raw/. Built entirely
 * from catalog/ + raw/papers/<slug>/{metadata.json,llm_analysis/latest.json}
 * for entries tagged relevant to this region+taxon.
 */
export async function buildWiki(input: WikiInput): Promise<string> {
  const dirName = regionTaxonSlug(input.region, input.taxonGroup);
  const dir = path.join(paths.wiki, dirName);
  await fs.mkdir(dir, { recursive: true });

  const details = await loadDetails(input.entries);
  const checklists = details.filter((d) => d.analysis?.isChecklist);
  const historical = details.filter((d) => d.entry.historical);
  const withCoordinates = details.filter((d) => d.entry.has_coordinates);
  const sortedByRelevance = [...details].sort((a, b) => (b.entry.llm_relevance ?? 0) - (a.entry.llm_relevance ?? 0));

  const overview = [
    `# ${dirName} — Overview`,
    ``,
    `## Literature summary`,
    ``,
    `- ${input.entries.length} documents in the corpus for this region/taxon.`,
    `- ${checklists.length} identified as checklists/surveys.`,
    `- ${historical.length} flagged historically important.`,
    `- ${withCoordinates.length} have extracted occurrence coordinates.`,
  ].join("\n");

  const importantPapers = [
    `# Important Papers — ${dirName}`,
    ``,
    ...sortedByRelevance
      .slice(0, 20)
      .map((d) => `- ${d.entry.flagged ? "🚩 " : ""}[${d.entry.llm_relevance ?? "?"}] ${citation(d.metadata, d.entry)}`),
  ].join("\n");

  const historicalLiterature = [
    `# Historical Literature — ${dirName}`,
    ``,
    ...historical
      .sort((a, b) => (a.metadata?.year ?? 9999) - (b.metadata?.year ?? 9999))
      .map((d) => `- ${citation(d.metadata, d.entry)}`),
  ].join("\n");

  interface SpeciesAggregate {
    commonName?: string;
    sources: Set<string>;
    occurrences: Set<string>;
    locations: Set<string>;
    dateRanges: Set<string>;
    /** True if flagged by the final review pass (analysis/finalReviewPass.ts) in ANY contributing source — advisory only, never hides the row. */
    flagged: boolean;
  }
  const speciesSet = new Map<string, SpeciesAggregate>();
  for (const d of details) {
    for (const sp of d.analysis?.species ?? []) {
      const existing: SpeciesAggregate =
        speciesSet.get(sp.scientificName) ??
        {
          commonName: sp.commonName ?? sp.backboneCommonName,
          sources: new Set<string>(),
          occurrences: new Set<string>(),
          locations: new Set<string>(),
          dateRanges: new Set<string>(),
          flagged: false,
        };
      existing.sources.add(d.entry.title);
      if (sp.occurrence) existing.occurrences.add(sp.occurrence);
      if (sp.location) existing.locations.add(sp.location);
      if (sp.dateRange?.from || sp.dateRange?.to) existing.dateRanges.add(`${sp.dateRange.from ?? "?"}–${sp.dateRange.to ?? "?"}`);
      if (sp.flagged) existing.flagged = true;
      speciesSet.set(sp.scientificName, existing);
    }
  }
  const species = [
    `# Species — ${dirName}`,
    ``,
    `| Scientific name | Common name | Occurrence | Location | Date range | Sources | Flagged |`,
    `|---|---|---|---|---|---|---|`,
    ...[...speciesSet.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, info]) =>
          `| **${name}** | ${info.commonName ?? ""} | ${[...info.occurrences].join("; ")} | ${[...info.locations].join("; ")} | ${[...info.dateRanges].join("; ")} | ${info.sources.size} | ${info.flagged ? "🚩" : ""} |`,
      ),
  ].join("\n");

  const authorsSeen = new Set<string>();
  const authorsList: string[] = [];
  for (const d of details) {
    const authors = d.metadata?.authors;
    if (authors && !authorsSeen.has(authors)) {
      authorsSeen.add(authors);
      authorsList.push(`- ${authors} — "${d.metadata?.title}"`);
    }
  }
  const authors = [`# Authors — ${dirName}`, ``, ...authorsList].join("\n");

  const timeline = [
    `# Timeline — ${dirName}`,
    ``,
    ...details
      .filter((d) => d.metadata?.year)
      .sort((a, b) => (a.metadata?.year ?? 0) - (b.metadata?.year ?? 0))
      .map((d) => `- ${d.metadata?.year}: ${d.entry.title}`),
  ].join("\n");

  await Promise.all([
    fs.writeFile(path.join(dir, "overview.md"), overview),
    fs.writeFile(path.join(dir, "important_papers.md"), importantPapers),
    fs.writeFile(path.join(dir, "historical_literature.md"), historicalLiterature),
    fs.writeFile(path.join(dir, "species.md"), species),
    fs.writeFile(path.join(dir, "authors.md"), authors),
    fs.writeFile(path.join(dir, "timeline.md"), timeline),
  ]);

  return dir;
}
