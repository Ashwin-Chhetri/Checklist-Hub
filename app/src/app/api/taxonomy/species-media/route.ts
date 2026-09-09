import { NextResponse } from "next/server";

export interface SpeciesMediaItem {
  url: string;
  creator?: string;
  license?: string;
  rightsHolder?: string;
  publisher?: string;
}

const GBIF_API = "https://api.gbif.org/v1";
const TIMEOUT_MS = 5000;

function gbifFetch(path: string): Promise<Response> {
  return fetch(`${GBIF_API}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function parseMedia(data: { results?: Array<Record<string, unknown>> }): SpeciesMediaItem[] {
  return (data.results ?? [])
    .filter((r) => r.type === "StillImage" && typeof r.identifier === "string")
    .slice(0, 5)
    .map((r) => ({
      url: r.identifier as string,
      creator: (r.creator as string) || undefined,
      license: (r.license as string) || undefined,
      rightsHolder: (r.rightsHolder as string) || undefined,
      publisher: (r.publisher as string) || undefined,
    }));
}

// ── Per-warm-instance caches ────────────────────────────────────────────────
// Same approach as the iNat taxonomy cache (see inat.server.ts): media and
// synonym→accepted mappings are effectively static at runtime, so entries
// never need invalidating. Keyed on the RESOLVED (accepted) taxon key so a
// synonym and its accepted usage share one media cache entry.
const mediaCache = new Map<string, SpeciesMediaItem[]>();
// The caller's raw taxonKey -> the accepted key it resolves to.
const resolvedKeyCache = new Map<string, string>();
// Coalesces concurrent requests for the same taxon — several rows/panels can
// ask for the same species within the same tick (duplicate rows, or several
// users with the same checklist open on one warm instance).
const inFlight = new Map<string, Promise<SpeciesMediaItem[]>>();

async function fetchMedia(taxonKey: string): Promise<SpeciesMediaItem[]> {
  const cached = mediaCache.get(taxonKey);
  if (cached) return cached;
  try {
    const res = await gbifFetch(`/species/${taxonKey}/media`);
    if (!res.ok) return [];
    const media = parseMedia(await res.json());
    // Only cache a non-empty result — an empty one may just mean this key
    // still needs the accepted-key fallback, and caching that would poison
    // the lookup permanently for this instance.
    if (media.length > 0) mediaCache.set(taxonKey, media);
    return media;
  } catch {
    return [];
  }
}

/**
 * A synonym/doubtful taxon key almost never carries its own media even when
 * the accepted usage it resolves to has plenty — GBIF's own species page
 * silently follows this same redirect before showing an image. `acceptedKey`
 * is the one field that reliably points at the usage GBIF actually attaches
 * media to (a synonym's own `nubKey` stays equal to its own key, so that
 * doesn't help).
 */
async function resolveAcceptedKey(taxonKey: string): Promise<string> {
  try {
    const res = await gbifFetch(`/species/${taxonKey}`);
    if (!res.ok) return taxonKey;
    const record = await res.json();
    const resolved = record.acceptedKey ? String(record.acceptedKey) : taxonKey;
    resolvedKeyCache.set(taxonKey, resolved);
    return resolved;
  } catch {
    return taxonKey;
  }
}

async function lookupMedia(taxonKey: string): Promise<SpeciesMediaItem[]> {
  // Once we've resolved this key before, skip straight to its media — no
  // record fetch needed. This is what makes every repeat lookup (the common
  // case: the same species viewed by many rows/users) effectively free.
  const knownResolved = resolvedKeyCache.get(taxonKey);
  if (knownResolved) return fetchMedia(knownResolved);

  // First time seeing this key: fetch its own media and resolve its accepted
  // key IN PARALLEL rather than sequentially. For the common case — the key
  // is already the accepted one — both calls land around the same time and
  // the record fetch turns out to have cost nothing extra. Only a genuine
  // synonym pays for a second, sequential media fetch (for its accepted key).
  const [directMedia, resolvedKey] = await Promise.all([
    fetchMedia(taxonKey),
    resolveAcceptedKey(taxonKey),
  ]);
  if (resolvedKey === taxonKey) return directMedia;
  return fetchMedia(resolvedKey);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taxonKey = searchParams.get("taxonKey");

  if (!taxonKey || !/^\d+$/.test(taxonKey)) {
    return NextResponse.json({ media: [] });
  }

  let task = inFlight.get(taxonKey);
  if (!task) {
    task = lookupMedia(taxonKey).finally(() => inFlight.delete(taxonKey));
    inFlight.set(taxonKey, task);
  }

  try {
    const media = await task;
    return NextResponse.json(
      { media },
      // Species media is effectively static — let Vercel's edge cache serve
      // repeat lookups (e.g. the same popular species across many
      // checklists/instances) without hitting this route at all.
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ media: [] });
  }
}
