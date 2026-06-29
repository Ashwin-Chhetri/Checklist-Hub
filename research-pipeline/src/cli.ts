#!/usr/bin/env node
import { Command } from "commander";
import { ScholarClient } from "./mcp/scholarClient.js";
import { searchScholar } from "./discovery/scholarSearch.js";
import { writeScholarSearchRaw } from "./corpus/rawStore.js";
import { resolveRegionBoundary } from "./regions/resolveRegionBoundary.js";
import { intersectRegion } from "./ecoregions/intersectRegion.js";
import { generateEcologicalNarrative } from "./ecoregions/ecologicalNarrative.js";
import { queryCatalog } from "./corpus/queryCatalog.js";
import { runDiscoveryPhase, runAnalysisPhase } from "./pipeline/runPipeline.js";
import { readRunStatus } from "./corpus/runStatus.js";
import { setReviewCandidateExcluded } from "./corpus/reviewStore.js";
import { ingestManualContribution, removeManualContribution } from "./discovery/manualContribution.js";
import { setCatalogEntryExcluded } from "./corpus/catalogBuilder.js";
import { buildOutputs } from "./corpus/outputsBuilder.js";
import { randomUUID } from "node:crypto";

const program = new Command();

program
  .name("research")
  .description("ChecklistHub standalone literature & ecological research pipeline");

program
  .command("discover")
  .description("Phase 1: run Scholar discovery only (no enrichment/full-text/analysis yet) and print results")
  .requiredOption("--region <region>", "Region of interest, e.g. \"Darjeeling district, West Bengal\"")
  .requiredOption("--taxon <taxon>", "Taxon group, e.g. Aves")
  .option("--results-per-query <n>", "Scholar results per query template", "10")
  .action(async (opts: { region: string; taxon: string; resultsPerQuery: string }) => {
    const client = new ScholarClient();
    console.log(`[discover] connecting to ScholarMCP...`);
    await client.connect();
    try {
      console.log(`[discover] region="${opts.region}" taxon="${opts.taxon}"`);
      const { queries, rawResults, candidates } = await searchScholar(
        client,
        opts.taxon,
        opts.region,
        Number(opts.resultsPerQuery),
      );
      console.log(`[discover] queries:`, queries);
      console.log(`[discover] raw results: ${rawResults.length}, deduped candidates: ${candidates.length}`);
      for (const candidate of candidates) {
        console.log(`  - [${candidate.year ?? "n.d."}] ${candidate.title}`);
        if (candidate.url) console.log(`      ${candidate.url}`);
      }
      await writeScholarSearchRaw(queries, rawResults);
      console.log(`[discover] wrote raw/scholar/ snapshot.`);
    } finally {
      await client.close();
    }
  });

program
  .command("ecology")
  .description("Phase 5: resolve a region's boundary, intersect against WWF ecoregions, and print the narrative")
  .requiredOption("--region <region>", "Region of interest, e.g. \"Darjeeling district, West Bengal\"")
  .action(async (opts: { region: string }) => {
    console.log(`[ecology] resolving boundary for "${opts.region}" via Nominatim...`);
    const boundary = await resolveRegionBoundary(opts.region);
    console.log(`[ecology] resolved name: ${boundary.name ?? "(none)"}, has geometry: ${Boolean(boundary.geometry)}`);

    const profile = intersectRegion(opts.region, boundary);
    console.log(`[ecology] ${profile.ecoregions.length} ecoregion(s) overlap >2%:`);
    for (const eco of profile.ecoregions) {
      console.log(`  - ${eco.ecoName} (${eco.biomeName}, ${eco.realm}) — ${(eco.overlapFraction * 100).toFixed(1)}%`);
    }

    const narrative = await generateEcologicalNarrative(profile);
    console.log(`\n[ecology] narrative:\n${narrative}`);
  });

program
  .command("query")
  .description("Query catalog/ directly — fast, structured, no raw file scanning")
  .option("--region <region>", "Filter by region (substring match)")
  .option("--taxa <taxa>", "Comma-separated taxon groups to filter by")
  .option("--historical", "Only historically-important documents")
  .option("--has-coordinates", "Only documents with extracted coordinates")
  .option("--min-relevance <n>", "Minimum LLM relevance score (0-100)")
  .action(async (opts: { region?: string; taxa?: string; historical?: boolean; hasCoordinates?: boolean; minRelevance?: string }) => {
    const results = await queryCatalog({
      region: opts.region,
      taxa: opts.taxa?.split(",").map((t) => t.trim()),
      historical: opts.historical ? true : undefined,
      hasCoordinates: opts.hasCoordinates ? true : undefined,
      minRelevance: opts.minRelevance ? Number(opts.minRelevance) : undefined,
    });
    console.log(`[query] ${results.length} matching catalog entries:`);
    for (const entry of results) {
      console.log(`  - [${entry.llm_relevance ?? "?"}] ${entry.title} (${entry.region.join(", ")} / ${entry.taxa.join(", ")})`);
    }
  });

program
  .command("run")
  .description("Stage A only: discovery -> enrichment -> citation expansion -> non-LLM relevance ranking. Pauses at \"awaiting_review\" — see `continue` for Stage B.")
  .requiredOption("--region <region>", "Region of interest, e.g. \"Darjeeling district, West Bengal\"")
  .requiredOption("--taxon <taxon>", "Taxon group, e.g. Aves")
  .option("--results-per-query <n>", "Scholar results per query template", "10")
  .option("--run-id <id>", "Run id (defaults to a generated UUID) — used for raw/runs/<id>.json status polling")
  .action(async (opts: { region: string; taxon: string; resultsPerQuery: string; runId?: string }) => {
    const runId = opts.runId ?? randomUUID();
    console.log(`[run] starting run ${runId} for region="${opts.region}" taxon="${opts.taxon}"`);
    await runDiscoveryPhase({
      region: opts.region,
      taxonGroup: opts.taxon,
      runId,
      resultsPerQuery: Number(opts.resultsPerQuery),
    });
    console.log(`[run] awaiting review. See raw/runs/${runId}-candidates.json, or \`continue --run-id ${runId}\` once curated.`);
  });

program
  .command("continue")
  .description("Stage B: resumes a run sitting at \"awaiting_review\" — full text -> ecology -> LLM analysis -> catalog/wiki/outputs, for the curated (non-excluded, score >= threshold) survivors only")
  .requiredOption("--run-id <id>", "Run id returned by `run`")
  .action(async (opts: { runId: string }) => {
    console.log(`[continue] resuming run ${opts.runId}`);
    await runAnalysisPhase(opts.runId);
    console.log(`[continue] done. See raw/, catalog/, wiki/, outputs/ for results.`);
  });

program
  .command("exclude-candidate")
  .description("Soft-delete (or restore) a document from a run's pre-fulltext review pool")
  .requiredOption("--run-id <id>", "Run id")
  .requiredOption("--slug <slug>", "Candidate slug to exclude/restore")
  .option("--restore", "Restore a previously-excluded candidate instead of excluding it")
  .action(async (opts: { runId: string; slug: string; restore?: boolean }) => {
    const candidate = await setReviewCandidateExcluded(opts.runId, opts.slug, !opts.restore);
    if (!candidate) {
      console.log(`RESULT_JSON:${JSON.stringify({ ok: false, reason: "Not found." })}`);
      process.exitCode = 1;
      return;
    }
    console.log(`RESULT_JSON:${JSON.stringify({ ok: true, slug: candidate.metadata.slug, excluded: candidate.excluded })}`);
  });

program
  .command("status")
  .description("Check a run's progress (polls raw/runs/<runId>.json)")
  .requiredOption("--run-id <id>", "Run id returned by `run`")
  .action(async (opts: { runId: string }) => {
    const status = await readRunStatus(opts.runId);
    console.log(status ?? `No status found for run ${opts.runId}`);
  });

program
  .command("contribute")
  .description("Ingest a user-supplied PDF or link as a manual contribution, through the same analysis/catalog/wiki pipeline as discovered papers")
  .requiredOption("--region <region>", "Region of interest, e.g. \"Darjeeling district, West Bengal\"")
  .requiredOption("--taxon <taxon>", "Taxon group, e.g. Aves")
  .option("--url <url>", "A DOI link, journal landing page, or direct PDF URL")
  .option("--pdf-path <path>", "Path to an already-saved PDF file on disk")
  .action(async (opts: { region: string; taxon: string; url?: string; pdfPath?: string }) => {
    if (!opts.url && !opts.pdfPath) {
      console.error("[contribute] Provide --url or --pdf-path.");
      process.exitCode = 1;
      return;
    }
    const entry = await ingestManualContribution({
      region: opts.region,
      taxonGroup: opts.taxon,
      url: opts.url,
      localPdfPath: opts.pdfPath,
    });
    // Printed as the final line so callers (the app's runContribute spawn
    // wrapper) can parse structured output instead of just an exit code.
    console.log(`RESULT_JSON:${JSON.stringify(entry)}`);
  });

program
  .command("remove-contribution")
  .description("Withdraw a manually-contributed paper (refuses to touch discovered/non-manual documents)")
  .requiredOption("--slug <slug>", "Catalog slug to remove")
  .action(async (opts: { slug: string }) => {
    const result = await removeManualContribution(opts.slug);
    console.log(`RESULT_JSON:${JSON.stringify(result)}`);
    if (!result.removed) process.exitCode = 1;
  });

program
  .command("exclude-document")
  .description("Soft-delete (or restore) a discovered document from region+taxon listings, without touching its raw evidence — see CatalogEntry.excluded")
  .requiredOption("--slug <slug>", "Catalog slug to exclude/restore")
  .option("--restore", "Restore a previously-excluded document instead of excluding it")
  .action(async (opts: { slug: string; restore?: boolean }) => {
    const entry = await setCatalogEntryExcluded(opts.slug, !opts.restore);
    if (!entry) {
      console.log(`RESULT_JSON:${JSON.stringify({ ok: false, reason: "Not found." })}`);
      process.exitCode = 1;
      return;
    }
    await buildOutputs();
    console.log(`RESULT_JSON:${JSON.stringify({ ok: true, slug: entry.slug, excluded: entry.excluded })}`);
  });

program.parseAsync(process.argv);
