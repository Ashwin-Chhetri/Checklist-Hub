import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSpecies } from "@/modules/species/hooks/useSpecies";
import { refreshEvidence, setRevisionDecision, setEvidenceSource } from "../services/evidenceService";
import type { SpeciesRevision, SpeciesEvidenceSource } from "@/types/species.types";

/** Evidence panel data + on-demand refresh action. */
export function useEvidencePanel(checklistId: string, speciesId: string, gadmGid?: string | null) {
  const speciesQuery = useSpecies(speciesId);
  const queryClient = useQueryClient();

  const refresh = useMutation({
    mutationFn: () => {
      const gbifTaxonKey = speciesQuery.data?.gbif_taxon_key;
      if (!gbifTaxonKey) throw new Error("Species has no resolved GBIF taxon key yet");
      return refreshEvidence(speciesId, gbifTaxonKey, gadmGid);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["species", "detail", speciesId] });
    },
  });

  const setDecision = useMutation({
    mutationFn: (vars: { index: number; decision: SpeciesRevision["decision"] }) =>
      setRevisionDecision(speciesId, vars.index, vars.decision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["species", "detail", speciesId] });
    },
  });

  // add/discard/restore are persisted + logged to activity_log (via the
  // set_evidence_source RPC) — unlike the local checkbox filter in
  // EvidencePanel, which is ephemeral UI state only.
  const setSource = useMutation({
    mutationFn: (vars: {
      action: "add" | "discard" | "restore";
      source: SpeciesEvidenceSource["source"];
      referenceText?: string | null;
      sourceLink?: string | null;
    }) => setEvidenceSource(checklistId, speciesId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["species", "detail", speciesId] });
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "activity"] });
    },
  });

  return {
    evidence: speciesQuery.data?.evidence,
    isLoading: speciesQuery.isLoading,
    refresh,
    setDecision,
    setSource,
  };
}
