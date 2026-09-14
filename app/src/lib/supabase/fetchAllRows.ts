/**
 * Pages through a Supabase/PostgREST query in batches, working around the
 * project's `db-max-rows` limit — an unbounded `.select()` silently
 * truncates past that limit instead of erroring, so any checklist with more
 * species than the limit would have some queries see the full list
 * (whichever ones page) and others see an arbitrary truncated slice
 * (whichever don't), producing inconsistent counts/rows between call sites
 * for no visible reason. Use this for any query that must return every row
 * for a checklist, not just a page a user is currently looking at.
 *
 * Termination is based on getting an empty page back, not on the page being
 * shorter than the requested `pageSize` — PostgREST enforces its own
 * server-side `db-max-rows` cap independent of the range requested, so a
 * page can come back shorter than `pageSize` while more rows remain.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length === 0) break;
  }
  return all;
}
