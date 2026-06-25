import { NextResponse } from "next/server";
import { isResearchPipelineAvailable, runSetDocumentExcluded } from "@/lib/research/runResearchPipeline.server";

// Soft-deletes (excluded: true) or restores (excluded: false) a discovered
// document from the Documents/Species listing — see research-pipeline's
// corpus/catalogBuilder.ts setCatalogEntryExcluded. Distinct from
// /api/research/contribute's DELETE, which hard-deletes and only ever
// touches manual contributions; this is the curation control for
// *discovered* literature, and is always reversible.
export async function POST(request: Request) {
  const { slug, excluded } = (await request.json()) as { slug?: string; excluded?: boolean };
  if (!slug || typeof excluded !== "boolean") {
    return NextResponse.json({ error: "slug and excluded (boolean) are required." }, { status: 400 });
  }

  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  const result = await runSetDocumentExcluded(slug, excluded);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed to update document." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, excluded: result.excluded });
}
