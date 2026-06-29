import { createClient } from "@/lib/supabase/client";

/** One species row's edited fields from the taxon.txt/vernacularname.txt package preview — only the keys actually changed are included, the rest are left untouched (see `apply_species_edits`, migration 0044). */
export interface SpeciesEditUpdate {
  species_id: string;
  scientific_name?: string;
  authorship?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  common_name?: string;
}

/** Writes back taxon.txt/vernacularname.txt cell edits to the underlying `species` rows. */
export async function applySpeciesEdits(checklistId: string, updates: SpeciesEditUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.rpc("apply_species_edits", {
    p_checklist_id: checklistId,
    p_updates: updates,
  });

  if (error) throw error;
}
