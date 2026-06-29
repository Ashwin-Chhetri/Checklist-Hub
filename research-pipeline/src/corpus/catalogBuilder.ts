import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { readLatestLlmAnalysis, writeLlmAnalysisSnapshot } from "./rawStore.js";
import { formatApaCitation } from "./citationFormatter.js";
import type { CatalogEntry, FullTextStatusRecord, LlmAnalysis, PaperMetadata } from "../types.js";

/**
 * Writes/updates catalog/<slug>.json — derived/summary data, freely
 * regenerable (unlike raw/). This is what later query/wiki/outputs steps
 * read instead of re-scanning raw PDFs/text, per the plan's explicit
 * requirement: "Give me all historical avifaunal checklists from Eastern
 * Himalaya with coordinates. This should hit catalog/. Not scan raw files."
 */
export async function updateCatalogEntry(input: {
  metadata: PaperMetadata;
  analysis: LlmAnalysis | null;
  fullTextStatus: FullTextStatusRecord["status"];
  region: string;
  taxonGroup: string;
  regionContainment?: CatalogEntry["regionContainment"];
}): Promise<CatalogEntry> {
  // A paper can become relevant across multiple region/taxon runs over
  // time (the corpus accumulates) — merge into any existing tags rather
  // than overwriting, even though the entry as a whole is freely
  // regenerable.
  const existing = await readCatalogEntry(input.metadata.slug);
  const region = new Set(existing?.region ?? []);
  region.add(input.region);
  const taxa = new Set(existing?.taxa ?? []);
  taxa.add(input.taxonGroup);

  const entry: CatalogEntry = {
    slug: input.metadata.slug,
    title: input.metadata.title,
    doi: input.metadata.doi,
    url: input.metadata.url,
    authors: input.metadata.authors,
    year: input.metadata.year,
    citation: formatApaCitation(input.metadata),
    llm_relevance: input.analysis?.semanticRanking,
    region_relevance: input.analysis?.regionRelevance,
    taxon_relevance: input.analysis?.taxonRelevance,
    regionContainment: input.regionContainment ?? existing?.regionContainment,
    region: [...region],
    taxa: [...taxa],
    documentType: input.analysis?.documentType ?? existing?.documentType ?? "other",
    greySignalCredible: input.analysis?.greySignalCredible ?? existing?.greySignalCredible,
    historical: existing?.historical || (input.analysis?.historicalImportance ?? 0) >= 60,
    has_coordinates: existing?.has_coordinates || Boolean(input.analysis?.coordinates && input.analysis.coordinates.length > 0),
    discoveredVia: input.metadata.discoveredVia,
    expandedFrom: input.metadata.expandedFrom ?? null,
    fullTextStatus: input.fullTextStatus,
    updatedAt: new Date().toISOString(),
    // Carried over from any prior run, never reset by re-analysis — a user
    // excluding a document is a deliberate, persistent choice, not
    // something a fresh pipeline pass should silently undo.
    excluded: existing?.excluded,
  };

  await fs.mkdir(paths.catalog, { recursive: true });
  await fs.writeFile(path.join(paths.catalog, `${input.metadata.slug}.json`), JSON.stringify(entry, null, 2));

  // Species list lives in a companion file rather than inline on the flat
  // CatalogEntry index — keeps catalog/<slug>.json itself small/queryable
  // (per the original "hit catalog/, not raw files" requirement) while
  // still persisting the full per-species occurrence/location/dateRange
  // detail bulk extraction produces.
  if (input.analysis?.species) {
    await fs.mkdir(path.join(paths.catalog, "species"), { recursive: true });
    await fs.writeFile(
      path.join(paths.catalog, "species", `${input.metadata.slug}.json`),
      JSON.stringify(input.analysis.species, null, 2),
    );
  }

  return entry;
}

/** Reads the companion catalog/species/<slug>.json written above — used by wikiBuilder.ts so species.md doesn't need to fall back to re-reading raw/ LLM snapshots for occurrence/location/dateRange detail. */
export async function readCatalogSpecies(slug: string): Promise<LlmAnalysis["species"]> {
  try {
    const raw = await fs.readFile(path.join(paths.catalog, "species", `${slug}.json`), "utf8");
    return JSON.parse(raw) as LlmAnalysis["species"];
  } catch {
    return undefined;
  }
}

/**
 * Toggles the soft-delete flag on a discovered document (see CatalogEntry's
 * `excluded` doc comment) — unlike removeManualContribution, this never
 * deletes anything on disk, just flips a flag that queryCatalog.ts and
 * outputsBuilder.ts then skip past. Works on any entry, not just manual
 * contributions, which is the point: this is specifically how a user
 * curates *discovered* literature out of a region+taxon's listing without
 * losing the underlying evidence.
 */
export async function setCatalogEntryExcluded(slug: string, excluded: boolean): Promise<CatalogEntry | null> {
  const entry = await readCatalogEntry(slug);
  if (!entry) return null;
  entry.excluded = excluded;
  await fs.writeFile(path.join(paths.catalog, `${slug}.json`), JSON.stringify(entry, null, 2));
  return entry;
}

/**
 * Applies advisory-only flags from the final review pass
 * (analysis/finalReviewPass.ts) — never excludes/removes anything, just
 * sets `flagged`/`flagReason` on the document's catalog entry and/or its
 * matching species records in `llm_analysis/latest.json`. Distinct from
 * `setCatalogEntryExcluded`, which is the user's own deliberate removal
 * decision.
 */
export async function applyReviewFlags(
  speciesFlags: Array<{ slug: string; scientificName: string; reason: string }>,
  documentFlags: Array<{ slug: string; reason: string }>,
): Promise<void> {
  const docFlagsBySlug = new Map(documentFlags.map((f) => [f.slug, f.reason]));
  for (const [slug, reason] of docFlagsBySlug) {
    const entry = await readCatalogEntry(slug);
    if (!entry) continue;
    entry.flagged = true;
    entry.flagReason = reason;
    await fs.writeFile(path.join(paths.catalog, `${slug}.json`), JSON.stringify(entry, null, 2));
  }

  const speciesFlagsBySlug = new Map<string, Map<string, string>>();
  for (const f of speciesFlags) {
    const bySpecies = speciesFlagsBySlug.get(f.slug) ?? new Map<string, string>();
    bySpecies.set(f.scientificName, f.reason);
    speciesFlagsBySlug.set(f.slug, bySpecies);
  }
  for (const [slug, bySpecies] of speciesFlagsBySlug) {
    const analysis = await readLatestLlmAnalysis<LlmAnalysis>(slug);
    if (!analysis?.species) continue;
    analysis.species = analysis.species.map((sp) =>
      bySpecies.has(sp.scientificName) ? { ...sp, flagged: true, flagReason: bySpecies.get(sp.scientificName) } : sp,
    );
    await writeLlmAnalysisSnapshot(slug, analysis);
  }
}

export async function readCatalogEntry(slug: string): Promise<CatalogEntry | null> {
  try {
    const raw = await fs.readFile(path.join(paths.catalog, `${slug}.json`), "utf8");
    return JSON.parse(raw) as CatalogEntry;
  } catch {
    return null;
  }
}

export async function listCatalogEntries(): Promise<CatalogEntry[]> {
  try {
    const files = await fs.readdir(paths.catalog);
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const raw = await fs.readFile(path.join(paths.catalog, f), "utf8");
          return JSON.parse(raw) as CatalogEntry;
        }),
    );
    return entries;
  } catch {
    return [];
  }
}
