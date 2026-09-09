import { NextResponse } from "next/server";

export interface SpeciesMediaItem {
  url: string;
  creator?: string;
  license?: string;
  rightsHolder?: string;
  publisher?: string;
}

const GBIF_API = "https://api.gbif.org/v1";
const TIMEOUT_MS = 6000;

function gbifFetch(path: string): Promise<Response> {
  return fetch(`${GBIF_API}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function toMediaItem(r: Record<string, unknown>): SpeciesMediaItem | null {
  if (r.type !== "StillImage" || typeof r.identifier !== "string") return null;
  return {
    url: r.identifier,
    creator: (r.creator as string) || undefined,
    license: (r.license as string) || undefined,
    rightsHolder: (r.rightsHolder as string) || undefined,
    publisher: (r.publisher as string) || undefined,
  };
}

/**
 * Curated reference images attached directly to the taxon record (e.g. a
 * source checklist's own photo library). Good quality when present, but a
 * great many taxa — especially anything not a well-known bird/plant, moths
 * included — simply have none here even though GBIF has plenty of
 * observation photos for the same species (see fetchOccurrenceMedia below).
 */
async function fetchDirectMedia(taxonKey: string): Promise<SpeciesMediaItem[]> {
  try {
    const res = await gbifFetch(`/species/${taxonKey}/media`);
    if (!res.ok) return [];
    const data = await res.json();
    const results: Array<Record<string, unknown>> = data.results ?? [];
    return results.map(toMediaItem).filter((m): m is SpeciesMediaItem => m !== null).slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Photos attached to citizen-science/museum OCCURRENCE records for this
 * taxon (iNaturalist, etc). This is what GBIF's own species page falls back
 * to and is why it always seems to have an image even for taxa with no
 * curated reference photo. The `taxonKey` filter already rolls synonyms up
 * to their accepted usage, so no separate accepted-key resolution is needed
 * here — confirmed by testing: searching by a known synonym key returns the
 * same records as searching by its accepted key.
 */
async function fetchOccurrenceMedia(taxonKey: string): Promise<SpeciesMediaItem[]> {
  try {
    const res = await gbifFetch(`/occurrence/search?taxonKey=${taxonKey}&mediaType=StillImage&limit=10`);
    if (!res.ok) return [];
    const data = await res.json();
    const occurrences: Array<{ media?: Array<Record<string, unknown>> }> = data.results ?? [];
    const items: SpeciesMediaItem[] = [];
    for (const occ of occurrences) {
      for (const raw of occ.media ?? []) {
        const item = toMediaItem(raw);
        if (item) items.push(item);
      }
      if (items.length >= 5) break;
    }
    return items.slice(0, 5);
  } catch {
    return [];
  }
}

// ── Per-warm-instance cache ─────────────────────────────────────────────────
// Same approach as the iNat taxonomy cache (see inat.server.ts): media is
// effectively static at runtime, so a resolved (non-empty) entry never needs
// invalidating. Empty results are deliberately never cached — for a taxon
// that genuinely has none, retrying costs one cheap round trip; caching a
// transient blip as "no image" would make it permanently silent instead.
const mediaCache = new Map<string, SpeciesMediaItem[]>();
// Coalesces concurrent requests for the same taxon — several rows/panels can
// ask for the same species within the same tick (duplicate rows, or several
// users with the same checklist open on one warm instance).
const inFlight = new Map<string, Promise<SpeciesMediaItem[]>>();

async function lookupMedia(taxonKey: string): Promise<SpeciesMediaItem[]> {
  const cached = mediaCache.get(taxonKey);
  if (cached) return cached;

  // Run both sources in parallel rather than trying direct-then-fallback:
  // for a checklist dominated by poorly-documented taxa (moths, etc) the
  // fallback is the common case, not the exception, so a sequential
  // try-then-fallback would pay full latency twice for most rows. Direct
  // media wins when present (better-curated), otherwise occurrence photos
  // fill in — bounding total latency to whichever source is slower, not
  // their sum.
  const [direct, occurrence] = await Promise.all([
    fetchDirectMedia(taxonKey),
    fetchOccurrenceMedia(taxonKey),
  ]);
  const media = direct.length > 0 ? direct : occurrence;
  if (media.length > 0) mediaCache.set(taxonKey, media);
  return media;
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
      // repeat lookups (the same species across many checklists/instances)
      // without hitting this route at all.
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ media: [] });
  }
}
