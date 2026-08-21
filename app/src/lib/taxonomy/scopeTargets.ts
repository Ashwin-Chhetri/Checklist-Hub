import type { RankName } from "./ranks";

/**
 * A taxonomic scope translated into what each evidence source can actually be
 * asked. Produced by `resolveScopeTargets` (server) and carried on
 * `DiscoveryContext` so every provider reads the same resolved view.
 */
export interface ScopeTargets {
  /** GBIF keys to query. Empty when the scope resolves to nothing queryable. */
  includeGbifKeys: number[];
  /** True when `includeGbifKeys` is broader than the real scope, so results need filtering. */
  gbifNeedsPostFilter: boolean;
  /** Family names to drop from GBIF results (from exclusions). */
  excludeFamilyNames: string[];
  /** Family names to keep when the include had to be widened. Empty means "keep all". */
  includeFamilyNames: string[];
  includeInatId: number | null;
  excludeInatIds: number[];
  /** Rank/name of the deepest include, for name-based sources and messaging. */
  deepestName: string | null;
  deepestRank: RankName | null;
}

/**
 * Whether a record belongs in the scope, judged on the family GBIF/iNat
 * reported for it.
 *
 * Family is the finest granularity every source reports consistently, and it
 * is the rank a superfamily/subfamily/tribe scope gets expanded to, so it is
 * the one usable common denominator for filtering. A record with no family at
 * all is kept: dropping unresolved names here would silently discard genuine
 * finds that the backbone simply hasn't matched yet.
 */
export function isFamilyInScope(family: string | null | undefined, targets: ScopeTargets | null): boolean {
  if (!targets || !family) return true;
  const name = family.toLowerCase();
  if (targets.excludeFamilyNames.some((f) => f.toLowerCase() === name)) return false;
  if (targets.gbifNeedsPostFilter && targets.includeFamilyNames.length) {
    return targets.includeFamilyNames.some((f) => f.toLowerCase() === name);
  }
  return true;
}
