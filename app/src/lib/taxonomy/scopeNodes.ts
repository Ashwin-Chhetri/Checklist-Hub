/**
 * Helpers for the `ScopeNode[]` form of a checklist's taxonomic scope, and
 * for keeping it interchangeable with the legacy flat seven-rank keys.
 *
 * Isomorphic — imported by both the selector (client) and the discovery /
 * suggestion code (server).
 */

import type { ScopeNode, TaxonomicScope } from "@/types/checklist.types";
import {
  CORE_RANKS,
  type CoreRankName,
  type RankName,
  compareRanks,
  isCoreRank,
  isRankName,
  rankIndex,
} from "./ranks";

/** Nodes sorted shallow → deep. Callers should treat scope order as canonical. */
export function sortNodes(nodes: ScopeNode[]): ScopeNode[] {
  return [...nodes].sort((a, b) => compareRanks(a.rank, b.rank));
}

export function includedNodes(nodes: ScopeNode[]): ScopeNode[] {
  return nodes.filter((n) => n.mode === "include");
}

export function excludedNodes(nodes: ScopeNode[]): ScopeNode[] {
  return nodes.filter((n) => n.mode === "exclude");
}

/**
 * Project a node list back onto the seven flat rank keys.
 *
 * Only `include` nodes contribute: a moth scope (Lepidoptera, minus
 * superfamily Papilionoidea) yields `{ ..., order: "Lepidoptera" }` with
 * nothing recording the exclusion — which is correct, since the flat shape
 * cannot express "everything but X" and a consumer reading it must not be
 * told the scope *is* Papilionoidea. Optional ranks are dropped for the same
 * reason: there is no flat key for them.
 */
export type FlatScope = Partial<Record<CoreRankName, string>>;

export function deriveFlatScope(nodes: ScopeNode[]): FlatScope {
  const flat: FlatScope = {};
  for (const node of includedNodes(nodes)) {
    if (isCoreRank(node.rank)) flat[node.rank as CoreRankName] = node.name;
  }
  return flat;
}

/** Build the full persisted scope object from a node list. */
export function buildScope(nodes: ScopeNode[], enabledRanks: RankName[] = []): TaxonomicScope {
  const sorted = sortNodes(nodes);
  return {
    ...deriveFlatScope(sorted),
    nodes: sorted,
    enabledRanks: [...enabledRanks].sort((a, b) => compareRanks(a, b)),
  };
}

/**
 * Reconstruct a node list from the flat keys alone, for checklists saved
 * before deep scopes existed. Everything is an `include` at a core rank with
 * no resolved keys — callers that need a GBIF key still have to resolve it.
 */
export function nodesFromFlatScope(scope: TaxonomicScope): ScopeNode[] {
  const nodes: ScopeNode[] = [];
  for (const rank of CORE_RANKS) {
    const name = scope[rank];
    if (typeof name === "string" && name.trim()) {
      nodes.push({ rank, name, mode: "include" });
    }
  }
  return nodes;
}

/**
 * The scope's node list, whichever shape it was stored in. Use this rather
 * than reading `scope.nodes` directly so pre-deep-scope rows keep working.
 */
export function scopeNodes(scope: TaxonomicScope | null | undefined): ScopeNode[] {
  if (!scope) return [];
  if (scope.nodes?.length) return sortNodes(scope.nodes);
  return nodesFromFlatScope(scope);
}

export function enabledRanksOf(scope: TaxonomicScope | null | undefined): RankName[] {
  const explicit = scope?.enabledRanks?.filter(isRankName) ?? [];
  if (explicit.length) return explicit;
  // Infer from the nodes themselves, so a scope built by the suggestion
  // engine renders its optional rows even without an explicit list.
  return scopeNodes(scope)
    .filter((n) => !isCoreRank(n.rank))
    .map((n) => n.rank);
}

/** The deepest included node — what defines how narrow the scope actually is. */
export function deepestIncludedNode(nodes: ScopeNode[]): ScopeNode | null {
  const included = includedNodes(nodes);
  if (!included.length) return null;
  return included.reduce((deepest, n) => (rankIndex(n.rank) > rankIndex(deepest.rank) ? n : deepest));
}

/**
 * Legacy `{ name, rank }` pair for the deepest selected rank, matching what
 * `buildDiscoveryContext` has always passed to name-based providers.
 */
export function deepestTaxon(scope: TaxonomicScope): { name: string | null; rank: string | null } {
  const node = deepestIncludedNode(scopeNodes(scope));
  return node ? { name: node.name, rank: node.rank } : { name: null, rank: null };
}

/** Human-readable path, e.g. `Animalia › Arthropoda › Lepidoptera − Papilionoidea`. */
export function formatScopePath(scope: TaxonomicScope, separator = " › "): string {
  const nodes = scopeNodes(scope);
  const included = includedNodes(nodes).map((n) => n.name).join(separator);
  const excluded = excludedNodes(nodes).map((n) => n.name);
  return excluded.length ? `${included} − ${excluded.join(", ")}` : included;
}

/** True when the scope has at least one included taxon, i.e. is usable. */
export function isScopeUsable(scope: TaxonomicScope | null | undefined): boolean {
  return includedNodes(scopeNodes(scope)).length > 0;
}

/**
 * A stable string for React Query keys / draft comparison. Two scopes that
 * would produce the same import must produce the same signature — so it has
 * to include exclusions, which the flat keys drop entirely.
 */
export function scopeSignature(scope: TaxonomicScope | null | undefined): string {
  return scopeNodes(scope)
    .map((n) => `${n.mode === "exclude" ? "-" : "+"}${n.rank}:${n.name}:${n.gbifKey ?? ""}:${n.inatId ?? ""}`)
    .join("|");
}
