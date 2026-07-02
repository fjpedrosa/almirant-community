/**
 * Notification port — shared interface for sending notifications across domains.
 *
 * Domain modules depend on this port instead of directly importing the
 * notification-service implementation, keeping domain code decoupled from
 * infrastructure (WebSocket, push, database).
 */

export type NotificationType = "assignment" | "comment" | "mention" | "status_changed";

export interface SendNotificationParams {
  recipientUserId: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  startAsRead?: boolean;
}

export interface NotificationPort {
  send(params: SendNotificationParams): Promise<unknown | null>;
  sendBatch(paramsList: SendNotificationParams[]): Promise<unknown[]>;
  sendMention(params: {
    mentionedUserId: string;
    actorUserId: string;
    workspaceId: string;
    entityType: string;
    entityId: string;
    entityTitle: string;
    link?: string;
  }): Promise<unknown | null>;
}
