import { NextResponse } from "next/server";
import { getInatLineage, resolveInatTaxon } from "@/lib/taxonomy/inat.server";
import { isRankName } from "@/lib/taxonomy/ranks";

/**
 * The GBIF → iNaturalist bridge: resolve a scientific name (typically one the
 * user picked from a GBIF-backed level) to its iNat taxon, so the levels below
 * it can be browsed at ranks GBIF does not carry.
 *
 * `ancestors` (comma-separated names already chosen higher in the chain)
 * disambiguates homonyms — genus names in particular get reused across
 * kingdoms, and picking the wrong one would silently reparent the whole scope.
 *
 * Pass `lineage=1` to also get the resolved ancestry, which the suggestion
 * engine uses to rebuild a full node list from a single matched taxon.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim();
  const rankParam = searchParams.get("rank") ?? "";
  const ancestors = (searchParams.get("ancestors") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rank = isRankName(rankParam) ? rankParam : undefined;

  const taxon = await resolveInatTaxon(name, rank, ancestors);
  if (!taxon) return NextResponse.json({ taxon: null, lineage: [] });

  const lineage = searchParams.get("lineage") === "1" ? await getInatLineage(taxon) : [];
  return NextResponse.json({ taxon, lineage });
}
