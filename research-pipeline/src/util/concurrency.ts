/**
 * Bounded-concurrency map — runs `fn` over `items` with at most
 * `concurrency` in flight at once. The original app's literature provider
 * was disabled in production for being "too slow" precisely because of
 * sequential per-item network calls (Crossref alone can take 5-6s per
 * lookup with no mailto configured) — every per-candidate loop in this
 * pipeline (enrichment, full-text resolution, LLM analysis) uses this
 * instead of a plain for-loop to avoid repeating that mistake.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
