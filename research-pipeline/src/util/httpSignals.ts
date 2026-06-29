/**
 * Every fetch wrapper in this pipeline (sources/crossref.ts, openAlex.ts,
 * semanticScholar.ts, fulltext/unpaywall.ts, sources/core.ts,
 * fulltext/resolveFullText.ts's downloadPdf) swallows a non-OK response into
 * a bare `null`/`[]` — indistinguishable from "no copy/result exists" even
 * when the real cause was a 429/503 rate limit. That's the actual signal
 * adaptiveConcurrency.ts's gates need to narrow correctly instead of
 * guessing a fixed concurrency cap. A single shared flag, not per-source: the
 * concurrency pools that consume this (Stage A enrichment, Stage B's merged
 * per-paper pass) aren't per-source either, so finer-grained tracking
 * wouldn't be actionable.
 */
let throttleSignalSeen = false;

/** Call sites opt in by reporting the real status code right where they currently swallow a non-OK response — purely additive, never changes what they return. */
export function recordHttpStatus(status: number): void {
  if (status === 429 || status === 503) throttleSignalSeen = true;
}

/** Returns true (and clears) if any 429/503 was recorded since the last check. */
export function consumeRecentThrottleSignal(): boolean {
  const seen = throttleSignalSeen;
  throttleSignalSeen = false;
  return seen;
}
