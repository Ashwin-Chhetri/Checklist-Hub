import { NextResponse } from "next/server";
import { resolveScopeTargets } from "@/lib/taxonomy/resolveScopeTargets.server";
import type { ScopeNode } from "@/types/checklist.types";

/**
 * POST { nodes } -> per-source query targets for a taxonomic scope.
 *
 * Lives behind a route rather than running in the browser because resolving a
 * scope can fan out into a dozen iNaturalist and GBIF lookups, and those share
 * the server-side cache and request pacing.
 */
export async function POST(request: Request) {
  let nodes: ScopeNode[];
  try {
    const body = await request.json();
    nodes = (body?.nodes ?? []) as ScopeNode[];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(nodes)) {
    return NextResponse.json({ error: "nodes must be an array" }, { status: 400 });
  }

  return NextResponse.json(await resolveScopeTargets(nodes));
}
