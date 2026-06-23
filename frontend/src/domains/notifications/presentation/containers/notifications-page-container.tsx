"use client";

import { useNotificationsPage } from "../../application/hooks/use-notifications-page";
import { NotificationFilterBar } from "../components/notification-filter-bar";
import { NotificationsList } from "../components/notifications-list";

export const NotificationsPageContainer: React.FC = () => {
  const {
    filters,
    notifications,
    isLoading,
    handleTypeChange,
    handleReadFilterChange,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleNotificationClick,
  } = useNotificationsPage();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notificaciones</h1>
        <p className="text-sm text-muted-foreground">
          Todas tus notificaciones y actualizaciones.
        </p>
      </div>

      <NotificationFilterBar
        filters={filters}
        onTypeChange={handleTypeChange}
        onReadFilterChange={handleReadFilterChange}
        onMarkAllAsRead={handleMarkAllAsRead}
      />

      <div className="rounded-lg border bg-card">
        <NotificationsList
          notifications={notifications}
          isLoading={isLoading}
          onMarkAsRead={handleMarkAsRead}
          onNotificationClick={handleNotificationClick}
        />
      </div>
    </div>
  );
};
