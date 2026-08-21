import { NextResponse } from "next/server";
import { getInatDescendantsAtRank } from "@/lib/taxonomy/inat.server";
import { isRankName } from "@/lib/taxonomy/ranks";

/**
 * Options for one rank of the scope selector, sourced from iNaturalist.
 *
 * Used for the ranks GBIF's backbone cannot express (superfamily, subfamily,
 * tribe, subgenus, sub/infra-orders and -classes, subphylum), and for core
 * ranks nested underneath one of those — once the scope passes through an
 * iNat-only rank, GBIF no longer knows the parent, so the rest of the chain
 * has to come from iNat too.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ancestorId = Number(searchParams.get("ancestorId"));
  const rank = searchParams.get("rank") ?? "";

  if (!Number.isFinite(ancestorId) || ancestorId <= 0) {
    return NextResponse.json({ error: "ancestorId is required" }, { status: 400 });
  }
  if (!isRankName(rank)) {
    return NextResponse.json({ error: `Unknown rank: ${rank}` }, { status: 400 });
  }

  const taxa = await getInatDescendantsAtRank(ancestorId, rank);
  return NextResponse.json({ taxa });
}
