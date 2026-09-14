/**
 * Splits `items` into chunks of `batchSize` and runs `run` over them with at
 * most `concurrency` batches in flight at once — bounds how many requests a
 * large bulk operation (species import, bulk review-status update, ...)
 * fires at the same time, instead of either going fully sequential (slow) or
 * fully concurrent (can overwhelm the API / race Supabase's refresh-token
 * rotation when the session is stale — see refreshSessionOnce).
 */
export async function runInBatches<T>(
  items: T[],
  batchSize: number,
  concurrency: number,
  run: (batch: T[]) => Promise<void>,
) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < batches.length) {
      const batch = batches[nextIndex++];
      await run(batch);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
}
