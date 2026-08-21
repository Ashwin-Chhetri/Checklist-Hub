/**
 * Server-side access to iNaturalist's taxonomy.
 *
 * iNat is used for the ranks GBIF's backbone simply does not have —
 * superfamily, subfamily, tribe, subtribe, subgenus, subphylum, subclass,
 * infraclass, suborder, infraorder. See `ranks.ts` for why.
 *
 * All iNat traffic funnels through here rather than going direct from the
 * browser so the cache and the request pacing are shared. iNat asks for no
 * more than ~1 request/second sustained (100/min hard), and a rank browser
 * fires a lot of small lookups, so `enqueue` serializes them with a minimum
 * gap instead of letting a burst through.
 */

import { type RankName, isRankName } from "./ranks";

const INAT_API = "https://api.inaturalist.org/v1";
const TIMEOUT_MS = 8000;
/**
 * One request per second — iNaturalist's own recommended rate. They throttle
 * above 100/min, so this leaves real headroom rather than sitting at the line.
 *
 * Caveat worth knowing: this paces one server instance. On serverless each
 * instance keeps its own queue and its own cache, so N warm instances can
 * issue N req/s between them. Steady-state volume stays low because taxonomy
 * responses are cached and never invalidated, but this is not a global
 * limiter — a shared cache would be needed for that.
 */
const MIN_REQUEST_GAP_MS = 1000;
/** Backoff before the single retry, on top of the queue's own pacing. */
const RETRY_DELAY_MS = 1500;

export interface InatTaxon {
  id: number;
  name: string;
  rank: RankName | string;
  rankLevel: number | null;
  parentId: number | null;
  /** Full lineage, root-first, ending with this taxon's own id. */
  ancestorIds: number[];
  commonName: string | null;
  observationsCount: number | null;
  /** Only set by search responses, when iNat reports which term it matched. */
  matchedTerm?: string | null;
}

interface InatTaxonRaw {
  id: number;
  name: string;
  rank?: string;
  rank_level?: number;
  parent_id?: number;
  ancestor_ids?: number[];
  preferred_common_name?: string;
  english_common_name?: string;
  observations_count?: number;
  matched_term?: string;
  is_active?: boolean;
}

function mapTaxon(raw: InatTaxonRaw): InatTaxon {
  return {
    id: raw.id,
    name: raw.name,
    rank: raw.rank && isRankName(raw.rank) ? (raw.rank as RankName) : (raw.rank ?? "unknown"),
    rankLevel: raw.rank_level ?? null,
    parentId: raw.parent_id ?? null,
    ancestorIds: raw.ancestor_ids ?? [],
    commonName: raw.preferred_common_name ?? raw.english_common_name ?? null,
    observationsCount: raw.observations_count ?? null,
    matchedTerm: raw.matched_term ?? null,
  };
}

// ── Request pacing ──────────────────────────────────────────────────────────
// A promise chain, not a timer loop: each queued call waits for the previous
// one to have started at least MIN_REQUEST_GAP_MS ago.
let queueTail: Promise<unknown> = Promise.resolve();
let lastStartedAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastStartedAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastStartedAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a task rejects, or one failure would
  // permanently wedge every later request behind it.
  queueTail = run.catch(() => undefined);
  return run;
}

// ── Response cache ──────────────────────────────────────────────────────────
// Per-warm-instance, same approach as the classification cache in
// suggest-scope. Taxonomy is effectively static at runtime, so entries never
// need invalidating; the map is bounded only by how many distinct lookups a
// single instance sees, which is small.
const responseCache = new Map<string, unknown>();

async function inatFetch<T>(path: string, params: Record<string, string | number>): Promise<T | null> {
  const url = new URL(`${INAT_API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const cacheKey = url.toString();

  if (responseCache.has(cacheKey)) return responseCache.get(cacheKey) as T;

  // One retry, because the alternative to a failed taxonomy lookup is a rank
  // that renders as "no options" — indistinguishable, to the user, from a
  // taxon that genuinely has no children. Under burst (many scopes resolved
  // back to back) iNaturalist throttles, and a single retry clears it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await enqueue(async () => {
        const res = await fetch(cacheKey, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "User-Agent": "checklist-hub/1.0 (biodiversity checklist taxonomy lookup)" },
        });
        // Thrown rather than returned so the caller can tell a genuine "no
        // such taxon" (a 200 with no results, worth caching) apart from a
        // request that simply didn't land.
        if (!res.ok) throw new Error(`iNaturalist ${path} responded ${res.status}`);
        return (await res.json()) as T;
      });
      responseCache.set(cacheKey, data);
      return data;
    } catch {
      // Deliberately NOT cached. A timeout or a rate-limit blip is transient,
      // and this cache has no expiry — storing the failure would make one bad
      // second permanently silent for this instance. Retrying self-heals.
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Taxa at `rank` anywhere beneath `ancestorId`.
 *
 * `taxon_id` on /v1/taxa is an ANCESTOR filter, not an id filter — that is
 * what makes this work. iNat's tree is uneven (Lepidoptera's direct children
 * are a mix of superfamily, family and genus), so filtering `parent_id` to a
 * rank would silently drop every taxon whose parent skipped a level. An
 * ancestor+rank query never does.
 */
export async function getInatDescendantsAtRank(ancestorId: number, rank: RankName): Promise<InatTaxon[]> {
  const data = await inatFetch<{ results?: InatTaxonRaw[] }>("/taxa", {
    taxon_id: ancestorId,
    rank,
    per_page: 200,
    order_by: "name",
    order: "asc",
  });
  return (data?.results ?? [])
    .filter((r) => r.is_active !== false)
    .map(mapTaxon);
}

/**
 * Resolve a scientific name to an iNat taxon — the GBIF → iNat bridge.
 *
 * `expectedAncestors` guards against homonyms (plenty of genus names are
 * reused across kingdoms): a candidate only wins if the names already chosen
 * higher in the chain all appear in its lineage.
 */
export async function resolveInatTaxon(
  name: string,
  rank?: RankName,
  expectedAncestors: string[] = [],
): Promise<InatTaxon | null> {
  const params: Record<string, string | number> = { q: name, per_page: 10 };
  if (rank) params.rank = rank;

  const data = await inatFetch<{ results?: InatTaxonRaw[] }>("/taxa", params);
  const results = (data?.results ?? []).filter((r) => r.is_active !== false).map(mapTaxon);
  if (!results.length) return null;

  const wanted = name.trim().toLowerCase();
  const exact = results.filter((t) => t.name.toLowerCase() === wanted);
  const pool = exact.length ? exact : results;
  if (pool.length === 1 || !expectedAncestors.length) return pool[0];

  // Disambiguate by lineage. Ancestor names aren't on the search payload, so
  // this needs one extra batch fetch — only when there's a genuine ambiguity.
  for (const candidate of pool) {
    const lineage = await getInatTaxaByIds(candidate.ancestorIds);
    const lineageNames = new Set(lineage.map((t) => t.name.toLowerCase()));
    if (expectedAncestors.every((a) => lineageNames.has(a.toLowerCase()))) return candidate;
  }
  return pool[0];
}

/**
 * Free-text search honouring common names, used by the suggestion engine —
 * this is what turns "butterflies" into superfamily Papilionoidea and
 * "snakes" into suborder Serpentes.
 *
 * Uses the autocomplete endpoint rather than plain /taxa search because it
 * ranks by how well the name matches, where /taxa ranks by observation count.
 * That difference decides real cases: for "Tiger", /taxa buries Panthera
 * tigris under a dozen tiger moths and tiger beetles that happen to be
 * photographed more often, while autocomplete returns it first.
 */
export async function searchInatTaxa(query: string, limit = 10): Promise<InatTaxon[]> {
  const data = await inatFetch<{ results?: InatTaxonRaw[] }>("/taxa/autocomplete", {
    q: query,
    per_page: limit,
  });
  return (data?.results ?? []).filter((r) => r.is_active !== false).map(mapTaxon);
}

/** Batch-fetch taxa by id — iNat accepts a comma-separated id list on /taxa/{ids}. */
export async function getInatTaxaByIds(ids: number[]): Promise<InatTaxon[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
  if (!unique.length) return [];

  const out: InatTaxon[] = [];
  // iNat caps the path-id list at 30 per request.
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const data = await inatFetch<{ results?: InatTaxonRaw[] }>(`/taxa/${chunk.join(",")}`, {});
    out.push(...(data?.results ?? []).map(mapTaxon));
  }
  return out;
}

/** A taxon's full lineage, root-first, excluding the taxon itself. */
export async function getInatLineage(taxon: InatTaxon): Promise<InatTaxon[]> {
  const ancestorIds = taxon.ancestorIds.filter((id) => id !== taxon.id);
  const lineage = await getInatTaxaByIds(ancestorIds);
  const order = new Map(ancestorIds.map((id, i) => [id, i]));
  return lineage.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
