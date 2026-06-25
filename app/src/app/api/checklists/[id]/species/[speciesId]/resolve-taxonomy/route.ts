import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillHierarchy, mergeEvidence, type MergeableEvidence } from "@/lib/taxonomy/mergeSpeciesData.server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; speciesId: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let decision: "agree" | "disagree" | "defer";
  try {
    ({ decision } = (await request.json()) as { decision: "agree" | "disagree" | "defer" });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (decision !== "agree" && decision !== "disagree" && decision !== "defer") {
    return NextResponse.json(
      { error: "decision must be 'agree', 'disagree', or 'defer'." },
      { status: 400 },
    );
  }

  const { id: checklistId, speciesId } = await params;

  const { data: result, error: rpcError } = await supabase.rpc("resolve_species_taxonomy", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_decision: decision,
  });

  if (rpcError) {
    const status = rpcError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  // ── Duplicate cleanup ────────────────────────────────────────────────────
  // Ingestion already sets gbif_taxon_key to the *accepted* taxon's key even
  // on a "synonym" row (only scientific_name keeps the original/imported
  // name) — so two rows that both resolve to the same accepted taxon are
  // already duplicates the moment they're imported, regardless of whether
  // anyone has clicked Agree/Disagree yet. Resolving one of them is the
  // natural point to fold any such duplicate in, so a checklist with every
  // synonym resolved never reaches the publish step still carrying
  // duplicate_groups for taxa whose synonym decision has already been made.
  if (decision !== "defer") {
    const { data: resolvedRow } = await supabase
      .from("species")
      .select("id, gbif_taxon_key, taxonomy_status, evidence, kingdom, phylum, class, order, family, genus")
      .eq("id", speciesId)
      .eq("checklist_id", checklistId)
      .single();

    if (resolvedRow?.gbif_taxon_key) {
      const { data: duplicateRow } = await supabase
        .from("species")
        .select("id, taxonomy_status, evidence, kingdom, phylum, class, order, family, genus")
        .eq("checklist_id", checklistId)
        .eq("is_active", true)
        .eq("gbif_taxon_key", resolvedRow.gbif_taxon_key)
        .neq("id", speciesId)
        .limit(1)
        .maybeSingle();

      if (duplicateRow) {
        // Prefer whichever row is already "accepted" as the canonical one —
        // if both are (e.g. an earlier-resolved synonym already settled
        // here), keep the pre-existing row rather than disturbing it.
        const [canonical, other] =
          duplicateRow.taxonomy_status === "accepted" && resolvedRow.taxonomy_status !== "accepted"
            ? [duplicateRow, resolvedRow]
            : [resolvedRow, duplicateRow];

        const mergedEvidence = mergeEvidence((canonical.evidence as MergeableEvidence) ?? {}, [
          (other.evidence as MergeableEvidence) ?? {},
        ]);
        const hierarchyFill = fillHierarchy(
          canonical as unknown as Record<string, unknown>,
          [other as unknown as Record<string, unknown>],
        );

        await supabase
          .from("species")
          .update({ evidence: mergedEvidence, ...hierarchyFill })
          .eq("id", canonical.id)
          .eq("checklist_id", checklistId);

        await supabase.rpc("merge_species", {
          p_species_id: other.id,
          p_checklist_id: checklistId,
          p_target_species_id: canonical.id,
        });

        return NextResponse.json({
          ...(result ?? { ok: true, decision }),
          merged: true,
          merged_species_id: other.id,
        });
      }
    }
  }

  return NextResponse.json(result ?? { ok: true, decision });
}
