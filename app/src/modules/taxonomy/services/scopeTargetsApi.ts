import type { ScopeTargets } from "@/lib/taxonomy/scopeTargets";
import type { ScopeNode } from "@/types/checklist.types";

/**
 * Resolve a scope's include/exclude nodes into per-source query targets.
 * Runs server-side (see the route) because it can fan out into many iNat and
 * GBIF lookups that share the server's cache and request pacing.
 */
export async function fetchScopeTargets(nodes: ScopeNode[]): Promise<ScopeTargets | null> {
  if (!nodes.length) return null;
  const response = await fetch("/api/taxonomy/scope-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes }),
  });
  if (!response.ok) return null;
  return (await response.json()) as ScopeTargets;
}
