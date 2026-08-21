import { getInatDescendantsAtRank, resolveInatTaxon, type InatTaxon } from "@/lib/taxonomy/inat.server";
import { attachGbifKeys, resolveGbifKey } from "@/lib/taxonomy/scopeGbifBridge.server";
import {
  type RankName,
  isGbifRank,
  nearestGbifRankAbove,
  nearestGbifRankBelow,
  rankIndex,
} from "@/lib/taxonomy/ranks";
import { deepestIncludedNode, excludedNodes, sortNodes } from "@/lib/taxonomy/scopeNodes";
import type { ScopeNode } from "@/types/checklist.types";
import type { ScopeTargets } from "./scopeTargets";

/**
 * Translates a scope's include/exclude nodes into concrete per-source query
 * targets.
 *
 * Two problems have to be solved here.
 *
 * **Ranks GBIF cannot query.** A scope ending at superfamily Papilionoidea has
 * no GBIF key, because GBIF's backbone has no superfamily taxa at all. The fix
 * is to expand *downwards*: ask iNaturalist for the families beneath it, then
 * match each family name back to GBIF. Papilionoidea becomes six family keys,
 * and GBIF gets queried once per key.
 *
 * **Exclusions.** GBIF's occurrence search has no "not this taxon" parameter,
 * so an exclusion cannot be pushed into the query. It is applied afterwards
 * instead, by resolving the excluded taxon down to the family (or genus) names
 * it contains and dropping matching records. iNaturalist needs none of this —
 * its `without_taxon_id` parameter expresses exclusion directly.
 */

/** How many expanded keys are worth querying individually before widening instead. */
const MAX_INCLUDE_KEYS = 30;

/** The iNat id for a node, resolving it by name if the scope didn't carry one. */
async function inatIdFor(node: { name: string; rank: RankName; inatId?: number | null }): Promise<number | null> {
  if (node.inatId) return node.inatId;
  return (await resolveInatTaxon(node.name, node.rank))?.id ?? null;
}

/** Names of every taxon at the nearest GBIF-queryable rank beneath `node`. */
async function expandToGbifRank(
  node: ScopeNode,
): Promise<{ rank: RankName; taxa: InatTaxon[] } | null> {
  const targetRank = nearestGbifRankBelow(node.rank);
  if (!targetRank) return null;

  const inatId = await inatIdFor(node);
  if (!inatId) return null;

  return { rank: targetRank, taxa: await getInatDescendantsAtRank(inatId, targetRank) };
}

/**
 * GBIF keys for a set of taxon names at one rank, recovering the two ways a
 * name legitimately fails to resolve.
 *
 * A family iNaturalist recognises can miss in GBIF for two quite different
 * reasons, and only one of them means the taxon is unreachable:
 *
 *  - **The name is a homonym.** GBIF has the family, but `species/match`
 *    refuses to choose between two usages. `resolveGbifKey` falls back to an
 *    exact backbone lookup that settles it by lineage. Hedylidae, Phoridae
 *    and Xylophagidae all land here.
 *  - **GBIF hasn't adopted the split.** The family is genuinely absent from
 *    GBIF's classification, but its species are all present filed under an
 *    older family — Micrelapidae's species sit in Atractaspididae,
 *    Cremifaniidae's in Chamaemyiidae. Descending to the genera recovers
 *    every one of them, because GBIF does have the genera.
 *
 * Without the second step those species vanish from the import with no
 * warning, which is worse than the over-broad scope the rank check prevents.
 */
async function toGbifKeys(taxa: InatTaxon[], rank: RankName, ancestors: string[]): Promise<number[]> {
  const keys: number[] = [];
  const unresolved: InatTaxon[] = [];

  for (const taxon of taxa) {
    const key = await resolveGbifKey(taxon.name, rank, ancestors);
    if (key) keys.push(key);
    else unresolved.push(taxon);
  }

  const deeperRank = nearestGbifRankBelow(rank);
  if (!unresolved.length || !deeperRank) return [...new Set(keys)];

  for (const taxon of unresolved) {
    for (const child of await getInatDescendantsAtRank(taxon.id, deeperRank)) {
      const key = await resolveGbifKey(child.name, deeperRank, [...ancestors, taxon.name]);
      if (key) keys.push(key);
    }
  }
  return [...new Set(keys)];
}

export async function resolveScopeTargets(rawNodes: ScopeNode[]): Promise<ScopeTargets> {
  const nodes = await attachGbifKeys(sortNodes(rawNodes));
  const deepest = deepestIncludedNode(nodes);
  const excludes = excludedNodes(nodes);

  const targets: ScopeTargets = {
    includeGbifKeys: [],
    gbifNeedsPostFilter: false,
    excludeFamilyNames: [],
    includeFamilyNames: [],
    includeInatId: null,
    excludeInatIds: [],
    deepestName: deepest?.name ?? null,
    deepestRank: deepest?.rank ?? null,
  };

  if (!deepest) return targets;

  // ── iNaturalist ─────────────────────────────────────────────────────────
  targets.includeInatId =
    deepest.inatId ?? (await resolveInatTaxon(deepest.name, deepest.rank))?.id ?? null;

  targets.excludeInatIds = (
    await Promise.all(
      excludes.map(async (n) => n.inatId ?? (await resolveInatTaxon(n.name, n.rank))?.id ?? null),
    )
  ).filter((id): id is number => typeof id === "number");

  // ── GBIF include ────────────────────────────────────────────────────────
  if (isGbifRank(deepest.rank) && deepest.gbifKey) {
    targets.includeGbifKeys = [deepest.gbifKey];
  } else {
    const ancestors = nodes
      .filter((n) => n.mode === "include" && rankIndex(n.rank) < rankIndex(deepest.rank))
      .map((n) => n.name);
    const expanded = await expandToGbifRank(deepest);
    const expandedNames = expanded?.taxa.map((t) => t.name) ?? [];

    // Size is checked before any key resolution: an infraorder can expand to
    // 160+ families, and resolving all of them only to discard the result
    // would be a few hundred wasted GBIF requests.
    const worthResolving = Boolean(expanded?.taxa.length) && expanded!.taxa.length <= MAX_INCLUDE_KEYS;
    const keys = worthResolving ? await toGbifKeys(expanded!.taxa, expanded!.rank, ancestors) : [];

    if (keys.length) {
      targets.includeGbifKeys = keys;
      if (expanded?.rank === "family") targets.includeFamilyNames = expandedNames;
    } else {
      // Too many taxa to query one by one, or none resolved. Fall back to the
      // nearest GBIF-queryable ancestor and narrow the results afterwards.
      const widerRank = nearestGbifRankAbove(deepest.rank);
      const ancestor = nodes.find(
        (n) => n.mode === "include" && n.rank === widerRank && n.gbifKey,
      );
      if (ancestor?.gbifKey) {
        targets.includeGbifKeys = [ancestor.gbifKey];
        targets.gbifNeedsPostFilter = true;
        if (expanded?.rank === "family") targets.includeFamilyNames = expandedNames;
      }
    }
  }

  // ── GBIF exclusions ─────────────────────────────────────────────────────
  // Each excluded taxon becomes the set of family names it contains, which is
  // what GBIF reports on every species record. An exclusion already at family
  // rank needs no expansion.
  const excludeFamilies = await Promise.all(
    excludes.map(async (node) => {
      if (node.rank === "family") return [node.name];
      if (rankIndex(node.rank) > rankIndex("family")) {
        // Below family — the whole family isn't excluded, so nothing to drop
        // at family granularity. Handled by iNat, and by the include filter.
        return [];
      }
      const expanded = await expandToGbifRank(node);
      return expanded?.rank === "family" ? expanded.taxa.map((t) => t.name) : [];
    }),
  );
  targets.excludeFamilyNames = [...new Set(excludeFamilies.flat())];

  return targets;
}
