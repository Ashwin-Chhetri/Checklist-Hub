/**
 * Filling GBIF backbone keys into a scope's nodes.
 *
 * Nodes built from iNaturalist (the suggestion engine, or any level browsed
 * below an iNat-only rank) arrive with an `inatId` but no `gbifKey`, and the
 * import path is driven by GBIF keys. Rather than matching every rank
 * separately, this matches the single deepest GBIF-supported rank: GBIF's
 * `species/match` returns the whole key chain (`kingdomKey` … `speciesKey`)
 * for a hit, so one request fills in every principal rank at once.
 *
 * Ranks GBIF has no taxa at (superfamily, tribe, subgenus, …) keep
 * `gbifKey: null` — that is a fact about the backbone, not a failure, and
 * `resolveScopeTargets` handles them by expanding to neighbouring ranks.
 */

import type { ScopeNode } from "@/types/checklist.types";
import { type RankName, isGbifRank, rankIndex, toGbifRank } from "./ranks";

const GBIF_API = "https://api.gbif.org/v1";
const TIMEOUT_MS = 8000;

interface GbifMatch {
  usageKey?: number;
  acceptedUsageKey?: number;
  matchType?: string;
  confidence?: number;
  rank?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
}

const matchCache = new Map<string, GbifMatch | null>();

/** Match one name at a known rank. Null when GBIF has no confident hit. */
export async function matchGbifAtRank(name: string, rank: RankName): Promise<GbifMatch | null> {
  if (!isGbifRank(rank)) return null;
  const cacheKey = `${rank}:${name.toLowerCase()}`;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey) ?? null;

  try {
    const url = new URL(`${GBIF_API}/species/match`);
    url.searchParams.set("name", name);
    url.searchParams.set("rank", toGbifRank(rank));
    url.searchParams.set("strict", "false");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      matchCache.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as GbifMatch;
    matchCache.set(cacheKey, isUsableMatch(data, rank) ? data : null);
    return matchCache.get(cacheKey) ?? null;
  } catch {
    matchCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Whether a GBIF match actually names a taxon at the rank we asked for.
 *
 * Requesting `rank=FAMILY` for a family GBIF's backbone doesn't carry does not
 * fail — it answers with `matchType: "HIGHERRANK"` and the key of whatever
 * ancestor it could reach, at confidence 95. Hedylidae comes back as kingdom
 * Animalia (usageKey 1). Accepting that would silently widen a butterfly
 * scope to every animal on earth, so the returned rank has to be checked
 * against the requested one rather than trusting the confidence score.
 */
function isUsableMatch(match: GbifMatch, rank: RankName): boolean {
  if (!match.usageKey || match.matchType === "NONE" || match.matchType === "HIGHERRANK") return false;
  return typeof match.rank === "string" && match.rank.toUpperCase() === toGbifRank(rank);
}

// ── Exact name lookup ───────────────────────────────────────────────────────
// GBIF's backbone dataset. Restricting name lookups to it keeps homonyms from
// other checklists out of the candidate pool.
const BACKBONE_DATASET_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

interface GbifNameUsage {
  key: number;
  rank?: string;
  taxonomicStatus?: string;
  acceptedKey?: number;
  scientificName?: string;
  parent?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
}

const usageCache = new Map<string, number | null>();

/**
 * Resolve a name to its GBIF backbone key by exact name lookup.
 *
 * `species/match` cannot do this job. It is a fuzzy single-answer matcher, so
 * a name that occurs twice in the backbone makes it give up and return
 * `matchType: "HIGHERRANK"` with an ancestor's key instead. Family Hedylidae
 * exists twice — once under Lepidoptera (key 6951) and once as a gastropod
 * synonym — so matching it yields kingdom Animalia. The same happens to
 * Phoridae and Xylophagidae, which are large, real families.
 *
 * `/species?name=&datasetKey=` returns every usage of the name with its
 * lineage attached, so the ambiguity can be settled properly: keep the ones at
 * the requested rank, prefer accepted over synonym, and pick the candidate
 * whose lineage contains a taxon the scope already established.
 */
export async function lookupGbifKeyByName(
  name: string,
  rank: RankName,
  expectedAncestors: string[] = [],
): Promise<number | null> {
  const cacheKey = `${rank}:${name.toLowerCase()}:${expectedAncestors.join(",").toLowerCase()}`;
  if (usageCache.has(cacheKey)) return usageCache.get(cacheKey) ?? null;

  let resolved: number | null = null;
  try {
    const url = new URL(`${GBIF_API}/species`);
    url.searchParams.set("name", name);
    url.searchParams.set("datasetKey", BACKBONE_DATASET_KEY);
    url.searchParams.set("limit", "50");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const data = (await res.json()) as { results?: GbifNameUsage[] };
      const wantedRank = toGbifRank(rank);
      const atRank = (data.results ?? []).filter(
        (u) => typeof u.rank === "string" && u.rank.toUpperCase() === wantedRank,
      );
      const accepted = atRank.filter((u) => u.taxonomicStatus === "ACCEPTED");
      const pool = accepted.length ? accepted : atRank;

      let chosen = pool[0] ?? null;
      if (pool.length > 1 && expectedAncestors.length) {
        const wanted = new Set(expectedAncestors.map((a) => a.toLowerCase()));
        chosen =
          pool.find((u) =>
            [u.kingdom, u.phylum, u.class, u.order, u.family, u.parent]
              .filter((v): v is string => Boolean(v))
              .some((v) => wanted.has(v.toLowerCase())),
          ) ?? chosen;
      }
      // A synonym still points at a real accepted taxon; follow it rather than
      // discarding a name that genuinely exists in the backbone.
      if (chosen) resolved = chosen.acceptedKey ?? chosen.key;
    }
  } catch {
    resolved = null;
  }

  usageCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * The GBIF key for a taxon, trying the cheap fuzzy match first and falling
 * back to exact name lookup when it comes back unusable.
 */
export async function resolveGbifKey(
  name: string,
  rank: RankName,
  expectedAncestors: string[] = [],
): Promise<number | null> {
  const match = await matchGbifAtRank(name, rank);
  if (match) return match.acceptedUsageKey ?? match.usageKey!;
  return lookupGbifKeyByName(name, rank, expectedAncestors);
}

const KEY_FIELD: Partial<Record<RankName, keyof GbifMatch>> = {
  kingdom: "kingdomKey",
  phylum: "phylumKey",
  class: "classKey",
  order: "orderKey",
  family: "familyKey",
  genus: "genusKey",
  species: "speciesKey",
};

/**
 * Return `nodes` with `gbifKey` populated wherever GBIF can supply one.
 * Nodes that already carry a key are left alone.
 */
export async function attachGbifKeys(nodes: ScopeNode[]): Promise<ScopeNode[]> {
  const needsKey = nodes.filter((n) => isGbifRank(n.rank) && !n.gbifKey);
  if (!needsKey.length) return nodes;

  // Match the deepest included principal rank first — its key chain covers
  // every shallower rank in one request.
  const deepestIncluded = needsKey
    .filter((n) => n.mode === "include")
    .reduce<ScopeNode | null>((deep, n) => (!deep || rankIndex(n.rank) > rankIndex(deep.rank) ? n : deep), null);

  const keyByRank = new Map<RankName, number>();
  if (deepestIncluded) {
    const match = await matchGbifAtRank(deepestIncluded.name, deepestIncluded.rank);
    if (match) {
      for (const [rank, field] of Object.entries(KEY_FIELD) as [RankName, keyof GbifMatch][]) {
        const key = match[field];
        if (typeof key === "number") keyByRank.set(rank, key);
      }
      keyByRank.set(deepestIncluded.rank, match.acceptedUsageKey ?? match.usageKey!);
    }
  }

  // Excluded nodes sit outside that chain by definition, so each needs its own
  // match. There are only ever a handful.
  const resolved = await Promise.all(
    nodes.map(async (node) => {
      if (!isGbifRank(node.rank) || node.gbifKey) return node;
      const fromChain = node.mode === "include" ? keyByRank.get(node.rank) : undefined;
      if (fromChain) return { ...node, gbifKey: fromChain };
      const ancestors = nodes
        .filter((n) => n.mode === "include" && rankIndex(n.rank) < rankIndex(node.rank))
        .map((n) => n.name);
      const key = await resolveGbifKey(node.name, node.rank, ancestors);
      return key ? { ...node, gbifKey: key } : node;
    }),
  );
  return resolved;
}
