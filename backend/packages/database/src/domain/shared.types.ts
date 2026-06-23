// ──────────────────────────────────────────────
// Shared enums, pagination, and cross-domain types
// ──────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ──────────────────────────────────────────────
// Entity Comments
// ──────────────────────────────────────────────

export type EntityType = "idea" | "todo" | "work_item" | "seed" | "feedback_item";
export type EntityEventTriggeredBy = "user" | "system" | "claude-code" | "codex";

export interface EntityComment {
  id: string;
  entityType: EntityType;
  entityId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityCommentWithUser extends EntityComment {
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
}

// ──────────────────────────────────────────────
// Entity Events
// ──────────────────────────────────────────────

export interface EntityEvent {
  id: string;
  entityType: EntityType;
  entityId: string;
  eventType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: string;
  triggeredByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EntityEventWithUser extends EntityEvent {
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
}
