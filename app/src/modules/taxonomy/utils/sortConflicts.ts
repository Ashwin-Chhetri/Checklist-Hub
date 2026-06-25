interface ConflictLike {
  authority: string;
}

/** True for any conflict entry whose suggestion came directly from the GBIF
 * backbone/live API (authority strings: "GBIF Backbone", "GBIF Live API",
 * "GBIF Backbone (vernacular match)") — as opposed to a within-batch
 * heuristic like "Common Name Match (within batch)", which is comparatively
 * weaker, indirect evidence (two different scientific names just happen to
 * share a common name in this import). */
export function isGbifAuthority(authority: string): boolean {
  return authority.startsWith("GBIF");
}

/** Orders conflict options so the GBIF-sourced suggestion is always shown
 * first and any other-source suggestion second — a stable sort, so multiple
 * entries within the same tier keep their original relative order. */
export function sortConflictsGbifFirst<T extends ConflictLike>(conflicts: T[]): T[] {
  return [...conflicts].sort((a, b) => Number(isGbifAuthority(b.authority)) - Number(isGbifAuthority(a.authority)));
}
