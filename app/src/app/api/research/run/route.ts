import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isResearchPipelineAvailable, startResearchRun } from "@/lib/research/runResearchPipeline.server";

// Kicks off a research-pipeline deep-search run for a region+taxon and
// returns immediately with a runId — never blocks on the run finishing
// (it can take minutes: Scholar search, citation expansion, full-text
// resolution, LLM analysis). The dialog polls GET /api/research/run/[runId]
// for progress/results. No Supabase writes happen anywhere in this flow —
// see research-pipeline/README.md "Design notes."
const MAX_RESULTS_PER_QUERY = 50;

export async function POST(request: Request) {
  const { region, taxonGroup, resultsPerQuery } = (await request.json()) as {
    region?: string;
    taxonGroup?: string;
    resultsPerQuery?: number;
  };

  if (!region || !taxonGroup) {
    return NextResponse.json({ error: "region and taxonGroup are required." }, { status: 400 });
  }

  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  const runId = randomUUID();
  const cappedResultsPerQuery = resultsPerQuery ? Math.min(Math.max(1, resultsPerQuery), MAX_RESULTS_PER_QUERY) : undefined;
  startResearchRun({ runId, region, taxonGroup, resultsPerQuery: cappedResultsPerQuery });

  return NextResponse.json({ runId });
}
