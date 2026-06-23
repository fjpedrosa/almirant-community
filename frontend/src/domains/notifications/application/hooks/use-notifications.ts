"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type { NotificationPreference } from "../../domain/types";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (params?: Record<string, string>) => ["notifications", "list", params] as const,
  unreadCount: ["notifications", "unread-count"] as const,
  preferences: ["notifications", "preferences"] as const,
};

export const useNotifications = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(notificationKeys.list(params ? Object.fromEntries(params) : undefined));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const result = await notificationsApi.list(params);
      return result;
    },
    enabled: !!confirmedActiveTeamId,
  });
};

export const useUnreadCount = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(notificationKeys.unreadCount);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!confirmedActiveTeamId,
  });
};

export const useMarkAsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
    },
  });
};

export const useMarkAllAsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
    },
  });
};

export const useNotificationPreferences = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(notificationKeys.preferences);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => notificationsApi.getPreferences() as Promise<NotificationPreference[]>,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useUpdateNotificationPreference = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { notificationType: string; inAppEnabled: boolean; emailEnabled: boolean; pushEnabled?: boolean }) =>
      notificationsApi.updatePreference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.preferences });
    },
  });
};
