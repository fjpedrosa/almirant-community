import { wsConnectionManager } from "./ws-connection-manager";

type FeedbackMetadataCarrier = {
  metadata?: Record<string, unknown> | null;
};

type FeedbackItemCarrier = FeedbackMetadataCarrier & {
  id: string;
  title?: string | null;
};

const stripUndefined = (
  changes: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined)
  );

export const resolveFeedbackOrganizationId = (
  item: FeedbackMetadataCarrier | null | undefined,
  fallbackOrganizationId?: string | null
): string | null => {
  if (fallbackOrganizationId) return fallbackOrganizationId;
  const rawOrganizationId = item?.metadata?.organizationId;
  return typeof rawOrganizationId === "string" && rawOrganizationId.trim().length > 0
    ? rawOrganizationId
    : null;
};

export const broadcastFeedbackItemCreated = (args: {
  item: FeedbackItemCarrier;
  organizationId?: string | null;
}) => {
  const organizationId = resolveFeedbackOrganizationId(
    args.item,
    args.organizationId
  );
  if (!organizationId) return;

  wsConnectionManager.broadcastToOrganization(organizationId, {
    type: "feedback-item:created",
    payload: {
      feedbackItemId: args.item.id,
      title: args.item.title ?? "",
    },
  });
};

export const broadcastFeedbackItemUpdated = (args: {
  item: FeedbackItemCarrier;
  changes: Record<string, unknown>;
  organizationId?: string | null;
}) => {
  const organizationId = resolveFeedbackOrganizationId(
    args.item,
    args.organizationId
  );
  if (!organizationId) return;

  wsConnectionManager.broadcastToOrganization(organizationId, {
    type: "feedback-item:updated",
    payload: {
      feedbackItemId: args.item.id,
      changes: stripUndefined(args.changes),
    },
  });
};

export const broadcastFeedbackItemDeleted = (args: {
  feedbackItemId: string;
  organizationId?: string | null;
}) => {
  if (!args.organizationId) return;

  wsConnectionManager.broadcastToOrganization(args.organizationId, {
    type: "feedback-item:deleted",
    payload: {
      feedbackItemId: args.feedbackItemId,
    },
  });
};

export const broadcastFeedbackCommentCreated = (args: {
  feedbackItemId: string;
  commentId: string;
  organizationId?: string | null;
}) => {
  if (!args.organizationId) return;

  wsConnectionManager.broadcastToOrganization(args.organizationId, {
    type: "feedback-comment:created",
    payload: {
      feedbackItemId: args.feedbackItemId,
      commentId: args.commentId,
    },
  });
};

export const broadcastFeedbackCommentUpdated = (args: {
  feedbackItemId: string;
  commentId: string;
  organizationId?: string | null;
}) => {
  if (!args.organizationId) return;

  wsConnectionManager.broadcastToOrganization(args.organizationId, {
    type: "feedback-comment:updated",
    payload: {
      feedbackItemId: args.feedbackItemId,
      commentId: args.commentId,
    },
  });
};

export const broadcastFeedbackCommentDeleted = (args: {
  feedbackItemId: string;
  commentId: string;
  organizationId?: string | null;
}) => {
  if (!args.organizationId) return;

  wsConnectionManager.broadcastToOrganization(args.organizationId, {
    type: "feedback-comment:deleted",
    payload: {
      feedbackItemId: args.feedbackItemId,
      commentId: args.commentId,
    },
  });
};
