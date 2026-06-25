import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// Spawns the standalone research-pipeline CLI (../research-pipeline, sibling
// to this Next.js app — see ../../../../checklistHub_architecture.md and
// research-pipeline/README.md for why it's a physically separate project)
// as a detached child process and returns immediately with a runId. This is
// the one place app/ touches research-pipeline at all: no shared imports, no
// Supabase writes — the dialog polls research-pipeline's own
// raw/runs/<runId>.json status file via the GET route instead of holding
// this request open.
//
// `detached: true` + `child.unref()` so the run survives independent of
// this request's lifecycle (and of `next dev` hot-reloads) — status is
// tracked entirely via the on-disk status file, not in-memory state here.

function researchPipelineDir(): string {
  return process.env.RESEARCH_PIPELINE_DIR
    ? path.resolve(process.env.RESEARCH_PIPELINE_DIR)
    : path.resolve(process.cwd(), "..", "research-pipeline");
}

export function isResearchPipelineAvailable(): { available: boolean; reason?: string } {
  const dir = researchPipelineDir();
  const cliPath = path.join(dir, "src", "cli.ts");
  const tsxPackage = path.join(dir, "node_modules", "tsx", "package.json");
  if (!fs.existsSync(cliPath)) {
    return { available: false, reason: `research-pipeline CLI not found at ${cliPath}. Set RESEARCH_PIPELINE_DIR or check the sibling folder exists.` };
  }
  if (!fs.existsSync(tsxPackage)) {
    return { available: false, reason: `research-pipeline dependencies not installed (missing ${tsxPackage}). Run "npm install" in research-pipeline/.` };
  }
  return { available: true };
}

export function startResearchRun(params: {
  runId: string;
  region: string;
  taxonGroup: string;
  resultsPerQuery?: number;
}): void {
  const dir = researchPipelineDir();
  const cliPath = path.join(dir, "src", "cli.ts");

  // stdio is redirected to a log file (not "ignore") so a crash mid-run is
  // diagnosable instead of leaving raw/runs/<runId>.json silently frozen —
  // the run-status file only records phase transitions, not why a run died
  // between them.
  const logDir = path.join(dir, "raw", "runs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${params.runId}.log`);
  const out = fs.openSync(logPath, "a");

  // Invoking node directly with `--import=tsx` (Node's native ESM loader
  // hook, supported since Node 18.19/20.6) instead of spawning
  // node_modules/tsx/dist/cli.mjs as a wrapper — that wrapper internally
  // re-spawns a second node process of its own (via cross-spawn, with no
  // windowsHide), which on Windows opened a second visible console window
  // on top of this spawn's own. `--import=tsx` runs the whole CLI in this
  // one process instead, so windowsHide below is the only thing needed to
  // keep this fully invisible.
  const args = ["--import=tsx", cliPath, "run", "--region", params.region, "--taxon", params.taxonGroup, "--run-id", params.runId];
  if (params.resultsPerQuery) args.push("--results-per-query", String(params.resultsPerQuery));

  const child = spawn(process.execPath, args, { cwd: dir, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
}

/**
 * Resumes a run sitting at "awaiting_review" — Stage B (full text -> LLM
 * analysis -> catalog/wiki/outputs), for whichever candidates survived
 * review. Detached the same way as startResearchRun, for the same reason:
 * this can take minutes (full-text fetches + LLM calls across multiple
 * papers), so it's spawned and polled rather than awaited inline.
 */
export function startResearchContinue(runId: string): void {
  const dir = researchPipelineDir();
  const cliPath = path.join(dir, "src", "cli.ts");

  const logDir = path.join(dir, "raw", "runs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${runId}.log`);
  const out = fs.openSync(logPath, "a");

  const args = ["--import=tsx", cliPath, "continue", "--run-id", runId];
  const child = spawn(process.execPath, args, { cwd: dir, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
}

/** Extracts the `RESULT_JSON:{...}` line the CLI prints as its last line of output (see research-pipeline/src/cli.ts), for structured results instead of just an exit code. */
function parseResultJson<T>(output: string): T | null {
  const line = output.split("\n").reverse().find((l) => l.startsWith("RESULT_JSON:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("RESULT_JSON:".length)) as T;
  } catch {
    return null;
  }
}

function runCli<T>(args: string[]): Promise<{ ok: boolean; output: string; result: T | null }> {
  const dir = researchPipelineDir();
  const cliPath = path.join(dir, "src", "cli.ts");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import=tsx", cliPath, ...args], { cwd: dir, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, output, result: parseResultJson<T>(output) }));
    child.on("error", (err) => resolve({ ok: false, output: `${output}\n${err.message}`, result: null }));
  });
}

/**
 * Runs `research contribute ...` synchronously and waits for it to finish —
 * unlike startResearchRun (a whole discovery run, can take minutes, so it's
 * detached+polled), ingesting a single user-supplied paper is fast enough
 * (one paper's enrichment/full-text/analysis) to just await directly in the
 * API route. Captures stdout/stderr so a failure is reportable to the user
 * instead of silently disappearing, and parses the structured catalog entry
 * the CLI prints on success.
 */
export function runContribute(params: {
  region: string;
  taxonGroup: string;
  url?: string;
  pdfPath?: string;
}): Promise<{ ok: boolean; output: string; entry: CatalogEntryResult | null }> {
  const args = ["contribute", "--region", params.region, "--taxon", params.taxonGroup];
  if (params.url) args.push("--url", params.url);
  if (params.pdfPath) args.push("--pdf-path", params.pdfPath);
  return runCli<CatalogEntryResult>(args).then(({ ok, output, result }) => ({ ok, output, entry: result }));
}

export interface CatalogEntryResult {
  slug: string;
  title: string;
  doi?: string;
  url?: string;
  year?: number;
  region: string[];
  taxa: string[];
  region_relevance?: number;
  taxon_relevance?: number;
  discoveredVia: string;
}

/** Withdraws a manually-contributed paper — see research-pipeline's discovery/manualContribution.ts removeManualContribution (refuses to touch discovered/non-manual documents). */
export function runRemoveContribution(slug: string): Promise<{ ok: boolean; removed: boolean; reason?: string }> {
  return runCli<{ removed: boolean; reason?: string }>(["remove-contribution", "--slug", slug]).then(({ ok, result }) => ({
    ok,
    removed: result?.removed ?? false,
    reason: result?.reason,
  }));
}

/** Excludes (or restores) a candidate from a run's pre-fulltext review pool — see research-pipeline's corpus/reviewStore.ts. Distinct from runSetDocumentExcluded below: this is pre-fulltext (Stage A), scoped to one run, and never touches catalog/ since these candidates haven't been analyzed/cataloged yet. */
export function runExcludeCandidate(runId: string, slug: string, excluded: boolean): Promise<{ ok: boolean; excluded?: boolean; reason?: string }> {
  const args = ["exclude-candidate", "--run-id", runId, "--slug", slug];
  if (!excluded) args.push("--restore");
  return runCli<{ ok: boolean; excluded?: boolean; reason?: string }>(args).then(({ ok, result }) => ({
    ok: ok && Boolean(result?.ok),
    excluded: result?.excluded,
    reason: result?.reason,
  }));
}

/** Soft-deletes (or restores) a *discovered* document from region+taxon listings — see research-pipeline's corpus/catalogBuilder.ts setCatalogEntryExcluded. Unlike runRemoveContribution, this never touches raw/ and works on any document, not just manual contributions. */
export function runSetDocumentExcluded(slug: string, excluded: boolean): Promise<{ ok: boolean; excluded?: boolean; reason?: string }> {
  const args = ["exclude-document", "--slug", slug];
  if (!excluded) args.push("--restore");
  return runCli<{ ok: boolean; excluded?: boolean; reason?: string }>(args).then(({ ok, result }) => ({
    ok: ok && Boolean(result?.ok),
    excluded: result?.excluded,
    reason: result?.reason,
  }));
}

export function researchPipelineRawDir(): string {
  return path.join(researchPipelineDir(), "raw");
}

export function researchPipelineCatalogDir(): string {
  return path.join(researchPipelineDir(), "catalog");
}

export function researchPipelineWikiDir(): string {
  return path.join(researchPipelineDir(), "wiki");
}

export function researchPipelineOutputsDir(): string {
  return path.join(researchPipelineDir(), "outputs");
}
