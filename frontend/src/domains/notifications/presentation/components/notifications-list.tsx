"use client";

import { InboxIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
import { NotificationRow } from "./notification-row";
import type { NotificationsListProps } from "../../domain/types";

const NotificationSkeleton = () => (
  <div className="flex items-start gap-4 px-4 py-3">
    <Skeleton className="h-2 w-2 rounded-full mt-2" />
    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  </div>
);

export const NotificationsList: React.FC<NotificationsListProps> = ({
  notifications,
  isLoading,
  onMarkAsRead,
  onNotificationClick,
}) => {
  const t = useTranslations("notifications");
  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <NotificationSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <InboxIcon className="h-12 w-12 mb-4 opacity-40" />
        <p className="text-lg font-medium">{t("empty")}</p>
        <p className="text-sm">{t("emptySubtitle")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {notifications.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          onMarkAsRead={onMarkAsRead}
          onClick={onNotificationClick}
        />
      ))}
    </div>
  );
};
