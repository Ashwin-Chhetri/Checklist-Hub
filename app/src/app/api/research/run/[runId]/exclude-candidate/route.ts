import { NextResponse } from "next/server";
import { isResearchPipelineAvailable, runExcludeCandidate } from "@/lib/research/runResearchPipeline.server";

// Excludes (or restores) a candidate from this run's pre-fulltext review
// pool — see research-pipeline's corpus/reviewStore.ts. Reversible, runs
// synchronously (a single JSON-file edit, not a pipeline stage).
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { slug, excluded } = (await request.json()) as { slug?: string; excluded?: boolean };
  if (!slug || typeof excluded !== "boolean") {
    return NextResponse.json({ error: "slug and excluded (boolean) are required." }, { status: 400 });
  }

  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  const result = await runExcludeCandidate(runId, slug, excluded);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed to update candidate." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, excluded: result.excluded });
}
