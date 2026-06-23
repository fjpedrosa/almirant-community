import type { PaginationMeta } from "@/domains/shared/domain/types";

export type NotificationType = "assignment" | "comment" | "mention" | "status_changed";

export interface Notification {
  id: string;
  recipientUserId: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  actorUserId: string | null;
  isRead: boolean;
  readAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    image: string | null;
  } | null;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  organizationId: string;
  notificationType: NotificationType;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  userAgent: string | null;
  deviceLabel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PushPermissionState = "granted" | "denied" | "default";
export type PushSubscriptionStatus = "unsupported" | "denied" | "pending" | "subscribed" | "unsubscribed";

export interface PushNotificationSettingsProps {
  isSupported: boolean;
  permissionState: PushPermissionState;
  subscriptionStatus: PushSubscriptionStatus;
  subscriptions: PushSubscriptionRecord[];
  isLoading: boolean;
  isSubscribing: boolean;
  onSubscribe: () => void;
  onUnsubscribe: (id: string) => void;
}

export interface NotificationFilters {
  type?: NotificationType;
  isRead?: boolean;
  page: number;
  limit: number;
}

export interface PaginatedNotificationsResponse {
  items: Notification[];
  meta: PaginationMeta;
}

// Presentational props

export interface NotificationBellProps {
  unreadCount: number;
  notifications: Notification[];
  isLoading: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNotificationClick: (notification: Notification) => void;
}

export interface NotificationRowProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onClick: (notification: Notification) => void;
}

export interface NotificationFilterBarProps {
  filters: NotificationFilters;
  onTypeChange: (type: NotificationType | undefined) => void;
  onReadFilterChange: (isRead: boolean | undefined) => void;
  onMarkAllAsRead: () => void;
}

export interface NotificationsListProps {
  notifications: Notification[];
  isLoading: boolean;
  onMarkAsRead: (id: string) => void;
  onNotificationClick: (notification: Notification) => void;
}

export interface NotificationPreferencesFormProps {
  preferences: NotificationPreference[];
  isLoading: boolean;
  onToggle: (type: NotificationType, channel: "inApp" | "email" | "push", enabled: boolean) => void;
}
