import { NextResponse } from "next/server";
import { lookupByVernacularName } from "@/lib/taxonomy/backbone.server";
import { extractScopeCandidates } from "@/lib/taxonomy/titleScopeCandidates";

/**
 * Best-effort taxonomic scope suggestion for a checklist title, e.g. "Birds
 * of Darjeeling" -> class Aves. Tries each candidate phrase extracted from
 * the title (most specific first) against the vernacular-name lookup, which
 * matches against the real GBIF backbone vernacular-names table rather than
 * any hardcoded list, so it generalizes to any group name GBIF has an
 * English common name for.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "";

  for (const candidate of extractScopeCandidates(title)) {
    const result = await lookupByVernacularName(candidate);
    if (result) {
      return NextResponse.json({ matchedTerm: candidate, classification: result.classification });
    }
  }

  return NextResponse.json({ matchedTerm: null, classification: null });
}
