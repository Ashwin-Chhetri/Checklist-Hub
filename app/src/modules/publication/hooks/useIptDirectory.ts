import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchNearbyIpts, resolveGbifDatasetUrl, searchIpts } from "../services/iptDirectoryService";

export function useNearbyIpts(countryCode: string | null) {
  return useQuery({
    queryKey: ["publication", "ipts", countryCode],
    queryFn: () => fetchNearbyIpts(countryCode as string),
    enabled: !!countryCode && countryCode.length === 2,
    staleTime: 1000 * 60 * 30,
  });
}

export function useIptSearch(query: string) {
  return useQuery({
    queryKey: ["publication", "ipts", "search", query],
    queryFn: () => searchIpts(query),
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
  });
}

export function useResolveGbifDataset() {
  return useMutation({
    mutationFn: (url: string) => resolveGbifDatasetUrl(url),
  });
}
