import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateChecklistSpeciesInput } from "@/types/checklist.types";
import { addSpeciesToChecklist } from "../services/speciesService";
import { appendSpeciesToList } from "../utils/patchSpeciesCache";

export function useAddSpeciesToChecklist(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (species: CreateChecklistSpeciesInput[]) => addSpeciesToChecklist(checklistId, species),
    onSuccess: (result) => {
      if (result.species.length > 0) {
        appendSpeciesToList(queryClient, checklistId, result.species);
      }
    },
  });
}
