/**
 * Adaptive concurrency — mirrors analysis/llmClient.ts's LaneState
 * widen-on-success/narrow-on-throttle pattern, generalized from "spacing
 * between calls" to "how many calls may run at once." Every fixed
 * concurrency constant in this pipeline (ENRICHMENT_CONCURRENCY,
 * FULLTEXT_CONCURRENCY) was a guessed number with no feedback loop — this
 * lets each pool find its own ceiling for whatever it's actually hitting
 * (Crossref/OpenAlex/Unpaywall/CORE/BHL), the same way llmClient.ts already
 * does per NVIDIA-hosted lane, instead of guessing a single constant that's
 * either too slow against a generous service or still too fast against a
 * strict one.
 */

const CLEAN_RUNS_TO_GROW = 5;

export interface AdaptiveConcurrencyGateOptions {
  /** Concurrency never narrows below this — a stalled/serialized pool is worse than a slow one. */
  floor: number;
  /** Concurrency never widens past this regardless of how clean the run looks — a safety cap, not a target. */
  ceiling: number;
  /** Starting point, ideally close to whatever fixed constant this replaces. */
  initial: number;
}

/**
 * Semaphore whose limit grows by 1 after `CLEAN_RUNS_TO_GROW` consecutive
 * clean completions and halves immediately on a single reported throttle
 * signal — same shape as LaneState.recordSuccess/widenSpacing, just acting
 * on a concurrency count instead of a spacing duration.
 */
export class AdaptiveConcurrencyGate {
  private readonly floor: number;
  readonly ceiling: number;
  currentLimit: number;
  private activeCount = 0;
  private consecutiveCleanRuns = 0;
  private waitQueue: Array<() => void> = [];

  constructor(options: AdaptiveConcurrencyGateOptions) {
    this.floor = options.floor;
    this.ceiling = options.ceiling;
    this.currentLimit = Math.max(options.floor, Math.min(options.ceiling, options.initial));
  }

  async acquire(): Promise<void> {
    if (this.activeCount >= this.currentLimit) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.activeCount += 1;
  }

  release(): void {
    this.activeCount -= 1;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  /** Caller reports this once per completed unit of work — true only when nothing about it looked rate-limited/degraded (see util/httpSignals.ts's consumeRecentThrottleSignal). */
  reportSuccess(): void {
    this.consecutiveCleanRuns += 1;
    if (this.consecutiveCleanRuns >= CLEAN_RUNS_TO_GROW && this.currentLimit < this.ceiling) {
      this.currentLimit += 1;
      this.consecutiveCleanRuns = 0;
      // A widened limit may immediately let queued workers proceed.
      while (this.activeCount < this.currentLimit && this.waitQueue.length > 0) {
        const next = this.waitQueue.shift();
        if (next) next();
      }
    }
  }

  reportThrottled(): void {
    this.consecutiveCleanRuns = 0;
    this.currentLimit = Math.max(this.floor, Math.floor(this.currentLimit / 2));
  }
}

/**
 * Same worker-pool shape as util/concurrency.ts's mapWithConcurrency, but
 * each worker re-checks the gate's live currentLimit before claiming the
 * next item, so a runtime widen/narrow takes effect immediately rather than
 * requiring the pool to be torn down and rebuilt.
 */
export async function mapWithAdaptiveConcurrency<T, R>(
  items: T[],
  gate: AdaptiveConcurrencyGate,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      await gate.acquire();
      try {
        results[i] = await fn(items[i] as T, i);
      } finally {
        gate.release();
      }
    }
  }

  // Start up to the gate's ceiling worth of workers — surplus workers simply
  // block in gate.acquire() until the limit widens, so this is safe even
  // when currentLimit starts well below ceiling.
  const workerCount = Math.min(gate.ceiling, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
