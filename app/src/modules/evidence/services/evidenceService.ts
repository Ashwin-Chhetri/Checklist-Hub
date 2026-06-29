import { createClient } from "@/lib/supabase/client";
import { getOccurrenceCount } from "@/modules/taxonomy/services/taxonomyApi";
import { getBasisOfRecordBreakdown } from "@/modules/evidence/services/gbifEvidence";
import type { SpeciesEvidence, SpeciesEvidenceSource, SpeciesRevision } from "@/types/species.types";

/**
 * On-demand refresh of GBIF occurrence counts for a single species
 * (workbench evidence panel "View Evidence" / refresh action).
 * V1: GBIF only, see implementation plan section 4.
 *
 * When `gadmGid` is available, `occurrence_count` is the region-scoped count
 * (matching what the map/sources list show as "inside region") and
 * `occurrence_count_outside_region` is the remainder of the worldwide total —
 * the two are kept separate rather than silently merged into one global
 * number that would overstate how much evidence ties the species to this
 * checklist's region specifically. Without a region, only the worldwide
 * total is available, so `occurrence_count_outside_region` is omitted.
 */
export async function refreshEvidence(
  speciesId: string,
  gbifTaxonKey: number,
  gadmGid?: string | null,
): Promise<SpeciesEvidence> {
  const supabase = createClient();
  const [worldwideCount, regionCount, basisOfRecordBreakdown] = await Promise.all([
    getOccurrenceCount(gbifTaxonKey),
    gadmGid ? getOccurrenceCount(gbifTaxonKey, gadmGid) : Promise.resolve(null),
    getBasisOfRecordBreakdown(gbifTaxonKey),
  ]);

  const { data: existing, error: fetchError } = await supabase
    .from("species")
    .select("evidence")
    .eq("id", speciesId)
    .single();
  if (fetchError) throw fetchError;

  const evidence: SpeciesEvidence = {
    ...(existing?.evidence ?? {}),
    occurrence_count: regionCount ?? worldwideCount,
    occurrence_count_outside_region: regionCount !== null ? worldwideCount - regionCount : undefined,
    basis_of_record_breakdown: basisOfRecordBreakdown,
    external_ids: {
      ...((existing?.evidence as SpeciesEvidence | undefined)?.external_ids ?? {}),
      gbif: gbifTaxonKey,
    },
  };

  const { error: updateError } = await supabase
    .from("species")
    .update({ evidence })
    .eq("id", speciesId);
  if (updateError) throw updateError;

  return evidence;
}

/**
 * Records the workbench's merge/retain/ignore decision for one entry in
 * `evidence.revisions`. This is a display/aggregation annotation only — the
 * underlying name, taxon key, and occurrence counts for that revision are
 * never modified.
 */
export async function setRevisionDecision(
  speciesId: string,
  index: number,
  decision: SpeciesRevision["decision"],
): Promise<SpeciesEvidence> {
  const supabase = createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("species")
    .select("evidence")
    .eq("id", speciesId)
    .single();
  if (fetchError) throw fetchError;

  const current = (existing?.evidence ?? {}) as SpeciesEvidence;
  const revisions = [...(current.revisions ?? [])];
  if (!revisions[index]) throw new Error(`No revision at index ${index}`);
  revisions[index] = { ...revisions[index], decision };

  const evidence: SpeciesEvidence = { ...current, revisions };

  const { error: updateError } = await supabase
    .from("species")
    .update({ evidence })
    .eq("id", speciesId);
  if (updateError) throw updateError;

  return evidence;
}

/**
 * Adds a manually-attested evidence source, or discards/restores an existing
 * one — unlike `refreshEvidence`/`setRevisionDecision` above (plain client
 * writes), this goes through the `set_evidence_source` security-definer RPC
 * since it also needs to write an audited `activity_log` entry, which RLS
 * doesn't let a regular client write directly.
 */
export async function setEvidenceSource(
  checklistId: string,
  speciesId: string,
  vars: {
    action: "add" | "discard" | "restore";
    source: SpeciesEvidenceSource["source"];
    referenceText?: string | null;
    sourceLink?: string | null;
  },
): Promise<void> {
  const res = await fetch(`/api/checklists/${checklistId}/species/${speciesId}/evidence-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: vars.action,
      source: vars.source,
      reference_text: vars.referenceText ?? null,
      source_link: vars.sourceLink ?? null,
    }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Failed to update evidence source.");
  }
}
