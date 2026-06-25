const PLACE_NAME_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;

// Words that commonly capitalize but aren't place names — filters obvious
// non-localities out of the cheap regex candidate pool before geocoding
// (geocoding every capitalized phrase would be wasteful and noisy).
const STOPWORDS = new Set([
  "The",
  "This",
  "These",
  "Those",
  "Genus",
  "Species",
  "Table",
  "Figure",
  "India",
  "Aves",
  "Mammalia",
  "Amphibia",
  // Sentence-starting pronouns/determiners — always capitalized at the
  // start of a sentence regardless of being a place name, which is exactly
  // the position this regex's candidates come from. Without this,
  // "We also recorded..." extracts "We" as a locality candidate.
  "We",
  "They",
  "It",
  "He",
  "She",
  "Our",
  "Their",
  "His",
  "Her",
  "Its",
]);

export interface LocalityCandidate {
  name: string;
  sourceSentence: string;
}

/**
 * Cheap regex pre-pass for place-name-shaped candidates near a species
 * mention — only run when extractCoordinateCandidates found nothing for
 * that document (per the plan: "only run this fallback if axis coordinate
 * extraction found nothing"). Caller is expected to geocode the resulting
 * candidates via Nominatim, biased to the region.
 */
export function extractLocalityCandidates(sourceSentence: string): LocalityCandidate[] {
  const candidates: LocalityCandidate[] = [];
  const seen = new Set<string>();
  for (const m of sourceSentence.matchAll(PLACE_NAME_PATTERN)) {
    const name = m[1];
    if (!name || STOPWORDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    candidates.push({ name, sourceSentence });
  }
  return candidates;
}

const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "checklisthub-research-pipeline/0.1 (biodiversity literature research tool)",
};

export interface GeocodedLocality extends LocalityCandidate {
  lat?: number;
  lng?: number;
}

/**
 * Geocodes a locality candidate biased to the region (appends the region
 * name to the query, same low-volume/sequential politeness convention as
 * the app's osmBoundary.server.ts — this is only ever called as a
 * last-resort fallback, never per-document by default).
 */
export async function geocodeLocality(candidate: LocalityCandidate, regionName: string): Promise<GeocodedLocality> {
  try {
    const url = new URL(NOMINATIM_API);
    url.searchParams.set("q", `${candidate.name}, ${regionName}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return candidate;

    const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const match = results[0];
    if (!match?.lat || !match?.lon) return candidate;

    return { ...candidate, lat: Number(match.lat), lng: Number(match.lon) };
  } catch {
    return candidate;
  }
}
