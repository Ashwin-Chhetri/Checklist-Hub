import type { QueryClient } from "@tanstack/react-query";
import type { Species } from "@/types/species.types";

// Surgical updates to the cached ["species","list",checklistId] array — avoids
// refetching all rows for a checklist (can be tens of thousands) on a single
// row's mutation or realtime event.

export function patchSpeciesInList(
  qc: QueryClient,
  checklistId: string,
  speciesId: string,
  updater: (species: Species) => Species,
) {
  qc.setQueryData<Species[]>(["species", "list", checklistId], (old) =>
    old?.map((s) => (s.id === speciesId ? updater(s) : s)) ?? old,
  );
}

export function patchSpeciesFromRow(qc: QueryClient, checklistId: string, row: Species) {
  qc.setQueryData<Species[]>(["species", "list", checklistId], (old) =>
    old?.map((s) => (s.id === row.id ? row : s)) ?? old,
  );
}

export function removeSpeciesFromList(qc: QueryClient, checklistId: string, speciesId: string) {
  qc.setQueryData<Species[]>(["species", "list", checklistId], (old) =>
    old?.filter((s) => s.id !== speciesId) ?? old,
  );
}

export function appendSpeciesToList(qc: QueryClient, checklistId: string, rows: Species[]) {
  qc.setQueryData<Species[]>(["species", "list", checklistId], (old) => (old ? [...old, ...rows] : rows));
}
