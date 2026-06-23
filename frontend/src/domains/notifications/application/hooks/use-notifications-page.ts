"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from "./use-notifications";
import type { Notification, NotificationType, NotificationFilters } from "../../domain/types";

const DEFAULT_FILTERS: NotificationFilters = {
  type: undefined,
  isRead: undefined,
  page: 1,
  limit: 20,
};

export const useNotificationsPage = () => {
  const router = useRouter();
  const [filters, setFilters] = useState<NotificationFilters>(DEFAULT_FILTERS);

  const params = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (filters.type) searchParams.set("type", filters.type);
    if (filters.isRead !== undefined) searchParams.set("isRead", String(filters.isRead));
    searchParams.set("page", String(filters.page));
    searchParams.set("limit", String(filters.limit));
    return searchParams;
  }, [filters]);

  const { data, isLoading } = useNotifications(params);
  const markAsReadMutation = useMarkAsRead();
  const markAllAsReadMutation = useMarkAllAsRead();

  const notifications = (data?.data ?? []) as Notification[];

  const handleTypeChange = useCallback((type: NotificationType | undefined) => {
    setFilters((prev) => ({ ...prev, type, page: 1 }));
  }, []);

  const handleReadFilterChange = useCallback((isRead: boolean | undefined) => {
    setFilters((prev) => ({ ...prev, isRead, page: 1 }));
  }, []);

  const handleMarkAsRead = useCallback(
    (id: string) => {
      markAsReadMutation.mutate(id);
    },
    [markAsReadMutation]
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsReadMutation.mutate();
  }, [markAllAsReadMutation]);

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.isRead) {
        markAsReadMutation.mutate(notification.id);
      }
      if (notification.link) {
        router.push(notification.link);
      }
    },
    [markAsReadMutation, router]
  );

  return {
    filters,
    notifications,
    isLoading,
    handleTypeChange,
    handleReadFilterChange,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleNotificationClick,
  };
};
