import { config, isLlmEnabled } from "../config.js";

const NVIDIA_API = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Shared LLM call wrapper — same NVIDIA-hosted endpoint and anti-fabrication
 * prompting discipline as the existing app's literature/llm.ts ("only what's
 * literally in the text/data provided, never invent"). Every prompt built on
 * top of this (relevanceScoring, speciesExtraction, ecologicalNarrative, ...)
 * inherits that discipline by convention, not by anything this function
 * enforces — the discipline lives in each prompt's wording.
 *
 * Two independent "lanes" (primary=llama, secondary=deepseek-v4-flash) each
 * have their own NVIDIA-hosted model/key and their own adaptive
 * spacing/batch-size state, so callers that want to cut wall-clock time can
 * split work across both and dispatch them concurrently (see
 * batchExtraction.ts and chunkedTableExtraction.ts) instead of serializing
 * everything through one model's rate limit. A caller that only ever uses
 * the primary lane sees identical behavior to before this lane was added.
 */
export { isLlmEnabled };

export type LlmLane = "primary" | "secondary";

function laneApiKey(lane: LlmLane): string | undefined {
  return lane === "primary" ? config.nvidiaApiKey : config.deepseekApiKey;
}

function laneModel(lane: LlmLane): string {
  return lane === "primary" ? config.llmModel : config.deepseekModel;
}

export function isLaneEnabled(lane: LlmLane): boolean {
  return Boolean(laneApiKey(lane));
}

/** Every lane with a configured API key, in priority order — what callers should split their work across. */
export function availableLanes(): LlmLane[] {
  return (["primary", "secondary"] as const).filter(isLaneEnabled);
}

/** Pulls the first JSON value (object or array) out of a response that may wrap it in prose/code fences. */
export function extractJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    const objStart = content.indexOf("{");
    const arrStart = content.indexOf("[");
    const start = [objStart, arrStart].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    if (start === undefined) return null;
    const closer = content[start] === "{" ? "}" : "]";
    const end = content.lastIndexOf(closer);
    if (end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

// 30s was too short for extraction-style prompts (full document text,
// longer generations) — every caller's try/catch silently swallowed the
// resulting timeout into an empty result, which is exactly what made
// "species extraction isn't working" so hard to diagnose: nothing ever
// surfaced the real error. 60s + retries, and a console.warn logged here
// (the one place every caller's failure passes through) so a failure is at
// least visible in the run's stdout/log going forward.
const LLM_TIMEOUT_MS = 60000;

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
  }
}

async function callLlmOnce(lane: LlmLane, prompt: string): Promise<string> {
  const response = await fetch(NVIDIA_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${laneApiKey(lane)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: laneModel(lane),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    throw new HttpError(response.status, `LLM request failed: ${response.status} ${await response.text().catch(() => "")}`, retryAfterMs);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This pipeline issues several LLM calls per paper concurrently
// (analyzePaper.ts's Promise.all of checklist/relevance/species, times
// ANALYSIS_CONCURRENCY papers in flight) — without a cap *per lane* here,
// that burst regularly exceeded NVIDIA's per-key rate limit and every call
// came back 429, which (with only one quick retry) gave up and silently
// returned empty results. This was the second, distinct cause behind
// "species extraction isn't working" on top of the earlier timeout bug:
// extraction can now succeed in isolation yet still fail under the
// pipeline's real concurrency. Serializing every call through one
// chokepoint *per lane* — plus a minimum spacing between dispatches, not
// just a concurrency cap — fixes it regardless of how many callers fire at
// once. The two lanes are still independent of each other (different
// keys/rate-limit windows), which is exactly what lets them run in
// parallel rather than just adding a second queue onto the same limit.
const MAX_CONCURRENT_LLM_CALLS = 1;
// Adaptive, not fixed — a fixed 2.5s spacing still hit 429s in practice once
// the pipeline reached llm_analysis (more cumulative calls than
// citation_expansion's preliminary check). Every 429 widens the spacing
// (capped at 20s); a run of clean successes narrows it back down — this
// tracks NVIDIA's actual per-key limit empirically instead of guessing a
// single constant that's either too slow on a generous key or still too
// fast on a strict one. Each lane tracks this independently since it's a
// different key/model with its own limit.
const MIN_SPACING_FLOOR_MS = 2500;
const MIN_SPACING_CEILING_MS = 20000;

const BATCH_SIZE_FLOOR = 1;
const BATCH_SIZE_CEILING = 12;
const CLEAN_BATCHES_TO_GROW = 3;

class LaneState {
  currentSpacingMs = MIN_SPACING_FLOOR_MS;
  consecutiveSuccesses = 0;
  activeCalls = 0;
  lastDispatchAt = 0;
  waitQueue: Array<() => void> = [];

  currentBatchSize = 4;
  consecutiveCleanBatches = 0;

  widenSpacing(): void {
    this.consecutiveSuccesses = 0;
    this.currentSpacingMs = Math.min(MIN_SPACING_CEILING_MS, Math.round(this.currentSpacingMs * 1.6));
  }

  recordSuccess(): void {
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= 3 && this.currentSpacingMs > MIN_SPACING_FLOOR_MS) {
      this.currentSpacingMs = Math.max(MIN_SPACING_FLOOR_MS, Math.round(this.currentSpacingMs * 0.8));
      this.consecutiveSuccesses = 0;
    }
  }

  async acquireSlot(): Promise<void> {
    if (this.activeCalls >= MAX_CONCURRENT_LLM_CALLS) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.activeCalls += 1;

    const elapsed = Date.now() - this.lastDispatchAt;
    if (elapsed < this.currentSpacingMs) await sleep(this.currentSpacingMs - elapsed);
    this.lastDispatchAt = Date.now();
  }

  releaseSlot(): void {
    this.activeCalls -= 1;
    const next = this.waitQueue.shift();
    if (next) next();
  }
}

const laneStates: Record<LlmLane, LaneState> = {
  primary: new LaneState(),
  secondary: new LaneState(),
};

/**
 * Adaptive batch size for batchExtraction.ts — independent of the spacing
 * state above (spacing governs *time between* calls; this governs *how much
 * one call covers*). Mirrors the same widen-on-failure/narrow-on-success
 * pattern, just in the other direction: batches grow on sustained clean
 * responses and shrink immediately on any sign of degradation (missing
 * slug, malformed JSON, or the call itself getting rate-limited), so each
 * lane finds its own ceiling for its own model rather than guessing a fixed
 * number that might be too conservative on a generous key/model or too
 * aggressive on a strict one.
 */
export function getBatchSize(lane: LlmLane = "primary"): number {
  return laneStates[lane].currentBatchSize;
}

/** Caller reports `clean: true` only when every requested item came back, parsed on the first attempt, with non-empty results where text clearly warranted them. Anything less (missing items, malformed JSON, a 429) is `clean: false`. */
export function recordBatchOutcome(clean: boolean, lane: LlmLane = "primary"): void {
  const state = laneStates[lane];
  if (clean) {
    state.consecutiveCleanBatches += 1;
    if (state.consecutiveCleanBatches >= CLEAN_BATCHES_TO_GROW && state.currentBatchSize < BATCH_SIZE_CEILING) {
      state.currentBatchSize = Math.min(BATCH_SIZE_CEILING, Math.ceil(state.currentBatchSize * 1.5));
      state.consecutiveCleanBatches = 0;
      console.log(`[llmClient:${lane}] batch size grown to ${state.currentBatchSize} after ${CLEAN_BATCHES_TO_GROW} consecutive clean batches.`);
    }
  } else {
    state.consecutiveCleanBatches = 0;
    if (state.currentBatchSize > BATCH_SIZE_FLOOR) {
      state.currentBatchSize = Math.max(BATCH_SIZE_FLOOR, Math.floor(state.currentBatchSize / 2));
      console.warn(`[llmClient:${lane}] batch size shrunk to ${state.currentBatchSize} after a degraded batch response.`);
    }
  }
}

const MAX_ATTEMPTS = 4;

export async function callLlm(prompt: string, lane: LlmLane = "primary"): Promise<string> {
  if (!isLaneEnabled(lane)) {
    throw new Error(
      lane === "primary" ? "LLM not configured — set NVIDIA_API_KEY." : "Secondary LLM lane not configured — set DEEPSEEK_API_KEY.",
    );
  }

  const state = laneStates[lane];
  await state.acquireSlot();
  try {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await callLlmOnce(lane, prompt);
        state.recordSuccess();
        return result;
      } catch (err) {
        lastErr = err;
        const isRateLimited = err instanceof HttpError && err.status === 429;
        if (isRateLimited) state.widenSpacing();
        if (attempt === MAX_ATTEMPTS) break;
        // Exponential backoff, longer for 429s specifically (NVIDIA's
        // free-tier rate limit resets on the order of seconds, not
        // milliseconds — an immediate retry just hits 429 again).
        const delayMs = isRateLimited ? 3000 * 2 ** (attempt - 1) : 1000 * attempt;
        const wait = err instanceof HttpError && err.retryAfterMs ? err.retryAfterMs : delayMs;
        console.warn(
          `[llmClient:${lane}] Attempt ${attempt}/${MAX_ATTEMPTS} failed (${err instanceof Error ? err.message : String(err)}), retrying in ${wait}ms...`,
        );
        await sleep(wait);
      }
    }
    console.warn(`[llmClient:${lane}] All ${MAX_ATTEMPTS} attempts failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    throw lastErr;
  } finally {
    state.releaseSlot();
  }
}
