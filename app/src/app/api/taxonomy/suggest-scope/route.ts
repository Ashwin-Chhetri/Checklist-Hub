import { NextResponse } from "next/server";
import { lookupByVernacularName, matchVernacularTaxonId } from "@/lib/taxonomy/backbone.server";
import { matchHigherRankVernacular } from "@/lib/taxonomy/higherRankVernacular.server";
import { extractScopeCandidates } from "@/lib/taxonomy/titleScopeCandidates";

/**
 * Best-effort taxonomic scope suggestion for a checklist title, e.g. "Birds
 * of Darjeeling" -> class Aves. Tries each candidate phrase extracted from
 * the title (most specific first) two ways:
 *  1. Against the local backbone mirror's vernacular lookup — covers
 *     species/genus-level common names (e.g. "Tiger"), which already have a
 *     matching row in the mirror's (species-only) taxa table.
 *  2. For higher-rank group names (e.g. "Birds", "Insects") the mirror's
 *     taxa table has no row for the group's own taxon (kingdom/phylum/
 *     class/order/family/genus aren't mirrored, only species-and-below),
 *     even though its vernacular-names table still lists them — so once we
 *     have a candidate taxon id from that table, its classification is
 *     resolved live from the public GBIF API by id (a single authoritative
 *     record, not a fuzzy text search).
 * Neither step hardcodes which words are taxonomic groups — both query real
 * GBIF vernacular-name data, so this generalizes to any group GBIF has an
 * English common name for.
 */

interface GbifSpeciesRecord {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  taxonomicStatus?: string;
  acceptedKey?: number;
}

// Per-warm-instance cache — group-level classifications (e.g. "Aves") are
// looked up repeatedly across users/checklists and don't change at runtime.
const classificationCache = new Map<number, GbifSpeciesRecord | null>();

async function fetchGbifClassification(taxonId: number): Promise<GbifSpeciesRecord | null> {
  if (classificationCache.has(taxonId)) return classificationCache.get(taxonId) ?? null;
  try {
    const res = await fetch(`https://api.gbif.org/v1/species/${taxonId}`);
    if (!res.ok) {
      classificationCache.set(taxonId, null);
      return null;
    }
    const data = (await res.json()) as GbifSpeciesRecord;
    const resolved =
      data.taxonomicStatus === "SYNONYM" && data.acceptedKey ? (await fetchGbifClassification(data.acceptedKey)) ?? data : data;
    classificationCache.set(taxonId, resolved);
    return resolved;
  } catch {
    classificationCache.set(taxonId, null);
    return null;
  }
}

function hasAnyRank(c: GbifSpeciesRecord): boolean {
  return Boolean(c.kingdom || c.phylum || c.class || c.order || c.family || c.genus || c.species);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "";

  for (const candidate of extractScopeCandidates(title)) {
    // Tried first and exact-only: an exact vernacular-name hit (e.g. "Insects"
    // -> Insecta) is unambiguous. Checking it before the local fuzzy lookup
    // below matters because that lookup's LIKE-based fallback would otherwise
    // match some unrelated species whose vernacular name merely *contains*
    // the group word (e.g. "Insects" fuzzy-matching a scale insect's common
    // name) before ever reaching the real group-level match.
    const taxonIds = await matchVernacularTaxonId(candidate);
    for (const taxonId of taxonIds) {
      const gbif = await fetchGbifClassification(taxonId);
      if (gbif && hasAnyRank(gbif)) {
        return NextResponse.json({
          matchedTerm: candidate,
          classification: {
            kingdom: gbif.kingdom ?? null,
            phylum: gbif.phylum ?? null,
            class: gbif.class ?? null,
            order: gbif.order ?? null,
            family: gbif.family ?? null,
            genus: gbif.genus ?? null,
            species: gbif.species ?? null,
          },
        });
      }
    }

    // The local mirror's vernacular-names extract is itself incomplete for
    // some higher ranks (e.g. class Reptilia has zero vernacular rows there,
    // despite GBIF's live per-taxon endpoint listing "Reptiles" for it) — a
    // supplementary index built once from every kingdom/phylum/class/order
    // in the real GBIF backbone (scripts/build-higher-rank-vernacular.mjs)
    // covers those gaps.
    const higherRank = matchHigherRankVernacular(candidate);
    if (higherRank) {
      return NextResponse.json({ matchedTerm: candidate, classification: higherRank });
    }

    // Species/genus-level common names (e.g. "Tiger"), which do have a row
    // in the mirror's (species-only) taxa table.
    const local = await lookupByVernacularName(candidate);
    if (local) {
      return NextResponse.json({ matchedTerm: candidate, classification: local.classification });
    }
  }

  return NextResponse.json({ matchedTerm: null, classification: null });
}
