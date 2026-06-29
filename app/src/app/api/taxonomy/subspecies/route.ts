import { NextResponse } from "next/server";
import { getSubspecies } from "@/lib/taxonomy/backbone.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taxonKey = searchParams.get("taxonKey");

  if (!taxonKey || !/^\d+$/.test(taxonKey)) {
    return NextResponse.json({ subspecies: [] });
  }

  const subspecies = await getSubspecies(Number(taxonKey));
  return NextResponse.json({ subspecies });
}
