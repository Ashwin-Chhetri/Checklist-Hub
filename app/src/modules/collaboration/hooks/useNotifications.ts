import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notificationsService";

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => listNotifications(userId as string),
    enabled: !!userId,
    refetchInterval: 30000,
  });
}

export function useUnreadNotificationCount(userId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", userId, "unread-count"],
    queryFn: () => countUnreadNotifications(userId as string),
    enabled: !!userId,
    refetchInterval: 30000,
  });
}

export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
    },
  });
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(userId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
    },
  });
}
