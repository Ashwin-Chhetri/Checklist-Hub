import { NextResponse } from "next/server";

export interface SpeciesMediaItem {
  url: string;
  creator?: string;
  license?: string;
  rightsHolder?: string;
  publisher?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taxonKey = searchParams.get("taxonKey");

  if (!taxonKey || !/^\d+$/.test(taxonKey)) {
    return NextResponse.json({ media: [] });
  }

  try {
    const response = await fetch(
      `https://api.gbif.org/v1/species/${taxonKey}/media`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return NextResponse.json({ media: [] });

    const data = await response.json();
    const results: Array<Record<string, unknown>> = data.results ?? [];

    const media: SpeciesMediaItem[] = results
      .filter((r) => r.type === "StillImage" && typeof r.identifier === "string")
      .slice(0, 5)
      .map((r) => ({
        url: r.identifier as string,
        creator: (r.creator as string) || undefined,
        license: (r.license as string) || undefined,
        rightsHolder: (r.rightsHolder as string) || undefined,
        publisher: (r.publisher as string) || undefined,
      }));

    return NextResponse.json({ media });
  } catch {
    return NextResponse.json({ media: [] });
  }
}
