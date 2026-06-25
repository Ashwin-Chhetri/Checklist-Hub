import { NextResponse } from "next/server";
import { lookupBackboneBatch } from "@/lib/taxonomy/backbone.server";

/** One item to normalize. Provide a GBIF backbone key, a name, or both. */
export interface NormalizeInput {
  /** Caller-chosen id echoed back so results can be matched to inputs. */
  id: string;
  /** A GBIF backbone taxon key (e.g. a GBIF occurrence speciesKey). */
  gbifKey?: number;
  /** A scientific name (canonical binomial preferred, authorship is ignored). */
  name?: string;
  /** Fallback vernacular/common name, used when the scientific name doesn't match the backbone. */
  commonName?: string;
}

export type NormalizeMatchType = "accepted" | "synonym" | "doubtful" | "none";

export interface NormalizeResult {
  id: string;
  /** Accepted backbone taxon key, or null when no match was found. */
  taxonKey: number | null;
  scientificName: string | null;
  canonicalName: string | null;
  /** Authorship string of the accepted taxon (e.g. "L." or "Müller, 1776"). */
  authorship: string | null;
  rank: string | null;
  /** How the input related to the returned accepted taxon. */
  matchType: NormalizeMatchType;
  /** The status of the row the input first matched (before synonym resolution). */
  originalStatus: string | null;
  /** The taxon_id of the row actually matched (may differ from `taxonKey` for synonyms/doubtful). */
  ownTaxonId: number | null;
  /** The matched row's own scientific name (the historical name, for synonyms/doubtful). */
  ownScientificName: string | null;
  /** Authorship string of the matched (possibly synonym) taxon. */
  ownAuthorship: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
  /** Year the accepted name was published, when the backbone build has this enrichment column. */
  namePublishedInYear: number | null;
}

export async function POST(request: Request) {
  const { items, kingdomHint } = (await request.json()) as {
    items?: NormalizeInput[];
    kingdomHint?: string;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const resultMap = await lookupBackboneBatch(
    items.map((it) => ({ id: it.id, gbifKey: it.gbifKey, name: it.name, commonName: it.commonName })),
    kingdomHint,
  );

  const results: NormalizeResult[] = items.map((item) => {
    const r = resultMap.get(item.id)!;
    return { id: item.id, ...r };
  });

  return NextResponse.json({ results });
}
