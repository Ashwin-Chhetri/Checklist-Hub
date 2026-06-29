import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function paperDir(slug: string): string {
  return path.join(paths.raw, "papers", slug);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes raw evidence (metadata.json, scholar.json, paper.pdf, extracted_text.md,
 * etc.) for a paper slug. Refuses to overwrite an existing file unless `refresh`
 * is set — raw/ is append-only/immutable by design (see README "Design notes").
 * When refresh is requested, the previous file is preserved as a dated sibling
 * rather than deleted, so provenance is never lost.
 */
export async function writeRawFile(
  slug: string,
  filename: string,
  content: string | Buffer,
  options: { refresh?: boolean } = {},
): Promise<{ written: boolean; path: string }> {
  const dir = paperDir(slug);
  await ensureDir(dir);
  const filePath = path.join(dir, filename);

  if (await pathExists(filePath)) {
    if (!options.refresh) {
      return { written: false, path: filePath };
    }
    const archivedName = `${filename}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    await fs.rename(filePath, path.join(dir, archivedName));
  }

  await fs.writeFile(filePath, content);
  return { written: true, path: filePath };
}

export async function readRawJson<T>(slug: string, filename: string): Promise<T | null> {
  const filePath = path.join(paperDir(slug), filename);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeRawJson(
  slug: string,
  filename: string,
  data: unknown,
  options: { refresh?: boolean } = {},
): Promise<{ written: boolean; path: string }> {
  return writeRawFile(slug, filename, JSON.stringify(data, null, 2), options);
}

/** llm_analysis/ is the one part of a paper's raw/ directory expected to be regenerated — dated snapshots + a latest.json pointer, never mutated in place. */
export async function writeLlmAnalysisSnapshot(slug: string, analysis: unknown): Promise<string> {
  const dir = path.join(paperDir(slug), "llm_analysis");
  await ensureDir(dir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `${timestamp}.json`);
  await fs.writeFile(snapshotPath, JSON.stringify(analysis, null, 2));
  await fs.writeFile(path.join(dir, "latest.json"), JSON.stringify(analysis, null, 2));
  return snapshotPath;
}

export async function readLatestLlmAnalysis<T>(slug: string): Promise<T | null> {
  const filePath = path.join(paperDir(slug), "llm_analysis", "latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Top-level raw/scholar/ — the immutable record of what each Scholar query actually returned. */
export async function writeScholarSearchRaw(
  runQueries: string[],
  rawResults: unknown[],
): Promise<void> {
  const dir = path.join(paths.raw, "scholar");
  await ensureDir(dir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(dir, `query-${timestamp}.json`), JSON.stringify(runQueries, null, 2));
  await fs.writeFile(
    path.join(dir, `scholar_results-${timestamp}.json`),
    JSON.stringify(rawResults, null, 2),
  );
}

/** extracted_text.md is plain text, not JSON — read separately from readRawJson. Shared by runPipeline.ts and discovery/manualContribution.ts. */
export async function readExtractedText(slug: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(paperDir(slug), "extracted_text.md"), "utf8");
  } catch {
    return null;
  }
}

export async function listPaperSlugs(): Promise<string[]> {
  const dir = path.join(paths.raw, "papers");
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
