import { NextResponse } from "next/server";
import { isResearchPipelineAvailable, startResearchContinue } from "@/lib/research/runResearchPipeline.server";

// Resumes a run sitting at "awaiting_review" — Stage B (full text -> LLM
// analysis -> catalog/wiki/outputs) for whichever candidates survived
// review. Detached/polled the same way as POST /api/research/run; the
// dialog keeps polling GET /api/research/run/[runId] afterward.
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  startResearchContinue(runId);
  return NextResponse.json({ ok: true });
}
