import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfile, updateProfile } from "../services/authService";
import type { Profile } from "@/types/collaboration.types";

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profiles", userId],
    queryFn: () => getProfile(userId as string),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      updates: Partial<
        Pick<Profile, "full_name" | "profession" | "location" | "institution" | "designation">
      >,
    ) => updateProfile(userId as string, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles", userId] });
    },
  });
}
