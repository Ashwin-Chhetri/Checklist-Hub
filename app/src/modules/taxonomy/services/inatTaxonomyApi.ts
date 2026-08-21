/**
 * Client access to iNaturalist taxonomy, via our own API routes rather than
 * api.inaturalist.org directly — the routes hold the shared cache and the
 * request pacing (see lib/taxonomy/inat.server.ts).
 */

import type { RankName } from "@/lib/taxonomy/ranks";

export interface InatTaxon {
  id: number;
  name: string;
  rank: RankName | string;
  rankLevel: number | null;
  parentId: number | null;
  ancestorIds: number[];
  commonName: string | null;
  observationsCount: number | null;
  matchedTerm?: string | null;
}

/** Taxa at `rank` anywhere beneath `ancestorId`. */
export async function getInatChildTaxa(ancestorId: number, rank: RankName): Promise<InatTaxon[]> {
  const url = new URL("/api/taxonomy/inat/children", window.location.origin);
  url.searchParams.set("ancestorId", String(ancestorId));
  url.searchParams.set("rank", rank);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`iNat children lookup failed: ${response.status}`);
  const data = await response.json();
  return (data.taxa ?? []) as InatTaxon[];
}

/**
 * Resolve a scientific name to an iNat taxon. Pass the names already selected
 * above it as `ancestors` so homonyms resolve to the right lineage.
 */
export async function resolveInatTaxon(
  name: string,
  rank?: RankName,
  ancestors: string[] = [],
): Promise<InatTaxon | null> {
  const url = new URL("/api/taxonomy/inat/resolve", window.location.origin);
  url.searchParams.set("name", name);
  if (rank) url.searchParams.set("rank", rank);
  if (ancestors.length) url.searchParams.set("ancestors", ancestors.join(","));

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`iNat resolve failed: ${response.status}`);
  const data = await response.json();
  return (data.taxon ?? null) as InatTaxon | null;
}
