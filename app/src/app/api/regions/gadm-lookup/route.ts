import { NextResponse } from "next/server";
import { callDataService } from "@/lib/dataService.server";

export interface GadmLookupResult {
  gid: string | null;
  level: number | null;
  matchedName: string | null;
}

// GADM mirror lives on the standalone reference-data-service
// (DigitalOcean) — see reference-data-service/src/gadm.js's lookup(),
// which this proxies to.
export async function POST(request: Request) {
  const { country, state, district } = (await request.json()) as {
    country?: string;
    state?: string;
    district?: string;
  };

  if (!country) {
    return NextResponse.json<GadmLookupResult>({ gid: null, level: null, matchedName: null });
  }

  try {
    const result = await callDataService<GadmLookupResult>("/gadm/lookup", {
      method: "POST",
      body: JSON.stringify({ country, state, district }),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[regions/gadm-lookup] reference-data-service call failed:", err);
    return NextResponse.json<GadmLookupResult>({ gid: null, level: null, matchedName: null });
  }
}
