import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const ROOT = process.cwd();

function dir(envVar: string, fallback: string): string {
  return path.resolve(ROOT, process.env[envVar] ?? fallback);
}

export const paths = {
  data: dir("DATA_DIR", "data"),
  raw: dir("RAW_DIR", "raw"),
  catalog: dir("CATALOG_DIR", "catalog"),
  wiki: dir("WIKI_DIR", "wiki"),
  outputs: dir("OUTPUTS_DIR", "outputs"),
};

export const config = {
  // Bumped from 350 to 800 after a real Google Scholar block was hit during
  // heavy manual testing — see discovery/scholarSearch.ts's error handling
  // and README "Design notes" for what to do if this still happens.
  scholarRequestDelayMs: Number(process.env.SCHOLAR_REQUEST_DELAY_MS ?? 800),
  nvidiaApiKey: process.env.NVIDIA_API_KEY,
  llmModel: process.env.LLM_MODEL ?? "meta/llama-3.1-70b-instruct",
  // Second, independent NVIDIA-hosted model — lets llmClient.ts run a
  // "secondary" lane in parallel with the primary one (split a batch/table
  // across both, merge results) instead of serializing everything through
  // one model's rate limit. Optional: when unset, every caller transparently
  // falls back to the primary lane only.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-ai/deepseek-v4-flash",
  openAlexMailto: process.env.OPENALEX_MAILTO,
  crossrefMailto: process.env.CROSSREF_MAILTO ?? process.env.OPENALEX_MAILTO,
  unpaywallEmail: process.env.UNPAYWALL_EMAIL,
  coreApiKey: process.env.CORE_API_KEY,
  bhlApiKey: process.env.BHL_API_KEY,
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY,
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY,
  googleCseId: process.env.GOOGLE_CSE_ID,
};

export function isGoogleCseEnabled(): boolean {
  return Boolean(config.googleCseApiKey && config.googleCseId);
}

/** True when at least one LLM lane (primary or secondary) is configured — see llmClient.ts's per-lane isLaneEnabled for which one specifically. */
export function isLlmEnabled(): boolean {
  return Boolean(config.nvidiaApiKey || config.deepseekApiKey);
}
