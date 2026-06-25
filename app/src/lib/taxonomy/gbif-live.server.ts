const GBIF_MATCH = "https://api.gbif.org/v1/species/match";
const GBIF_SPECIES = "https://api.gbif.org/v1/species";

export interface GbifLiveResult {
  status: "accepted" | "synonym" | "doubtful" | "unresolved";
  /** Canonical name of the accepted taxon (null when unresolved) */
  canonicalName: string | null;
  /** The imported/matched name's canonical form */
  matchedCanonicalName: string | null;
  /** Authorship of the accepted taxon */
  authorship: string | null;
  /** GBIF backbone taxon key of the accepted taxon */
  usageKey: number | null;
}

const UNRESOLVED: GbifLiveResult = {
  status: "unresolved",
  canonicalName: null,
  matchedCanonicalName: null,
  authorship: null,
  usageKey: null,
};

export async function resolveViaGbifLive(name: string): Promise<GbifLiveResult> {
  try {
    const matchRes = await fetch(
      `${GBIF_MATCH}?name=${encodeURIComponent(name)}&strict=false`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!matchRes.ok) return UNRESOLVED;

    const match = await matchRes.json();

    // Only trust exact canonical hits — fuzzy/higher-rank matches risk false positives
    if (match.matchType !== "EXACT" || (match.confidence ?? 0) < 90) return UNRESOLVED;

    const rawStatus = (match.status as string | undefined)?.toUpperCase();
    const matchedCanonicalName: string | null = match.canonicalName ?? null;

    if (rawStatus === "ACCEPTED") {
      return {
        status: "accepted",
        canonicalName: match.canonicalName ?? null,
        matchedCanonicalName,
        authorship: match.authorship ?? null,
        usageKey: match.usageKey ?? null,
      };
    }

    if (rawStatus === "DOUBTFUL") {
      return {
        status: "doubtful",
        canonicalName: match.canonicalName ?? null,
        matchedCanonicalName,
        authorship: match.authorship ?? null,
        usageKey: match.usageKey ?? null,
      };
    }

    if (rawStatus === "SYNONYM" && match.acceptedUsageKey) {
      // For synonyms, the match's canonicalName is the SYNONYM's name.
      // Fetch the accepted taxon to get the current accepted canonical name.
      const acceptedRes = await fetch(
        `${GBIF_SPECIES}/${match.acceptedUsageKey}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!acceptedRes.ok) {
        return {
          status: "synonym",
          canonicalName: null,
          matchedCanonicalName,
          authorship: null,
          usageKey: match.acceptedUsageKey,
        };
      }
      const accepted = await acceptedRes.json();
      return {
        status: "synonym",
        canonicalName: accepted.canonicalName ?? null,
        matchedCanonicalName,
        authorship: accepted.authorship ?? null,
        usageKey: match.acceptedUsageKey,
      };
    }

    return UNRESOLVED;
  } catch {
    return UNRESOLVED;
  }
}

/**
 * Resolves multiple names against the live GBIF API in parallel.
 * Failures are silent — each name falls back to UNRESOLVED independently.
 */
export async function resolveViaGbifLiveBatch(
  names: string[],
): Promise<Map<string, GbifLiveResult>> {
  const entries = await Promise.allSettled(
    names.map(async (name) => [name, await resolveViaGbifLive(name)] as const),
  );
  const out = new Map<string, GbifLiveResult>();
  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      const [name, result] = entry.value;
      out.set(name, result);
    }
  }
  return out;
}
