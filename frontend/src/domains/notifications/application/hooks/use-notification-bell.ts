"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useNotifications, useUnreadCount, useMarkAsRead, useMarkAllAsRead } from "./use-notifications";
import type { Notification, NotificationBellProps } from "../../domain/types";

export const useNotificationBell = (): NotificationBellProps => {
  const router = useRouter();

  const params = new URLSearchParams({ limit: "5" });
  const { data: notificationsData, isLoading } = useNotifications(params);
  const { data: unreadCountData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = (notificationsData?.data ?? []) as Notification[];
  const unreadCount = unreadCountData?.count ?? 0;

  const handleMarkAsRead = useCallback(
    (id: string) => {
      markAsRead.mutate(id);
    },
    [markAsRead]
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead.mutate();
  }, [markAllAsRead]);

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.isRead) {
        markAsRead.mutate(notification.id);
      }
      if (notification.link) {
        router.push(notification.link);
      }
    },
    [markAsRead, router]
  );

  return {
    unreadCount,
    notifications,
    isLoading,
    onMarkAsRead: handleMarkAsRead,
    onMarkAllAsRead: handleMarkAllAsRead,
    onNotificationClick: handleNotificationClick,
  };
};
