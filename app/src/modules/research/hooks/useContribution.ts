import { useMutation } from "@tanstack/react-query";
import { contributeUrl, contributeFile, removeContribution } from "../services/deepSearchService";
import type { ManualContribution } from "../services/deepSearchService";

export function useContribution(
  region: string,
  taxonGroup: string,
  onContributed?: (entry: ManualContribution) => void,
  onRemoved?: (slug: string) => void,
) {
  const contributeUrlMutation = useMutation({
    mutationFn: (url: string) => contributeUrl(region, taxonGroup, url),
    onSuccess: onContributed,
  });
  const contributeFileMutation = useMutation({
    mutationFn: (file: File) => contributeFile(region, taxonGroup, file),
    onSuccess: onContributed,
  });
  const removeMutation = useMutation({
    mutationFn: (slug: string) => removeContribution(slug),
    onSuccess: (_, slug) => onRemoved?.(slug),
  });

  return {
    contributeUrl: contributeUrlMutation.mutate,
    contributeFile: contributeFileMutation.mutate,
    removeContribution: removeMutation.mutate,
    isContributing: contributeUrlMutation.isPending || contributeFileMutation.isPending,
    isRemoving: removeMutation.isPending,
    contributionError: (contributeUrlMutation.error ?? contributeFileMutation.error) as Error | null,
    contributionSucceeded: contributeUrlMutation.isSuccess || contributeFileMutation.isSuccess,
    reset: () => {
      contributeUrlMutation.reset();
      contributeFileMutation.reset();
    },
  };
}
