import { useQuery } from "@tanstack/react-query";
import { listChecklists } from "../services/checklistService";

export function useChecklists() {
  return useQuery({
    queryKey: ["checklists"],
    queryFn: listChecklists,
  });
}
