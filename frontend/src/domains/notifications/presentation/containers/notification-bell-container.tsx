"use client";

import { useNotificationBell } from "../../application/hooks/use-notification-bell";
import { NotificationBell } from "../components/notification-bell";

export const NotificationBellContainer: React.FC = () => {
  const props = useNotificationBell();

  return <NotificationBell {...props} />;
};
