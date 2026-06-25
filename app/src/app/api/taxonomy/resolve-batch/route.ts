import { NextResponse } from "next/server";
import { callDataService } from "@/lib/dataService.server";

// GBIF backbone mirror lives on the standalone reference-data-service
// (DigitalOcean) — see reference-data-service/src/backbone.js's
// resolveBatchTaxa, which this proxies to.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    speciesKeys?: number[];
    includeVernacularNames?: boolean;
  };

  const { speciesKeys, includeVernacularNames = false } = body;

  if (!Array.isArray(speciesKeys) || speciesKeys.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  try {
    const result = await callDataService<{ rows: Array<Record<string, unknown>> }>("/backbone/resolve-batch", {
      method: "POST",
      body: JSON.stringify({ speciesKeys, includeVernacularNames }),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[taxonomy/resolve-batch] reference-data-service call failed:", err);
    return NextResponse.json(
      { rows: [], error: "GBIF backbone reference data is unavailable on this server." },
      { status: 503 },
    );
  }
}
