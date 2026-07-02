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

export const resolveFeedbackWorkspaceId = (
  item: FeedbackMetadataCarrier | null | undefined,
  fallbackWorkspaceId?: string | null
): string | null => {
  if (fallbackWorkspaceId) return fallbackWorkspaceId;
  const rawWorkspaceId = item?.metadata?.workspaceId;
  return typeof rawWorkspaceId === "string" && rawWorkspaceId.trim().length > 0
    ? rawWorkspaceId
    : null;
};

export const broadcastFeedbackItemCreated = (args: {
  item: FeedbackItemCarrier;
  workspaceId?: string | null;
}) => {
  const workspaceId = resolveFeedbackWorkspaceId(
    args.item,
    args.workspaceId
  );
  if (!workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(workspaceId, {
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
  workspaceId?: string | null;
}) => {
  const workspaceId = resolveFeedbackWorkspaceId(
    args.item,
    args.workspaceId
  );
  if (!workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(workspaceId, {
    type: "feedback-item:updated",
    payload: {
      feedbackItemId: args.item.id,
      changes: stripUndefined(args.changes),
    },
  });
};

export const broadcastFeedbackItemDeleted = (args: {
  feedbackItemId: string;
  workspaceId?: string | null;
}) => {
  if (!args.workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(args.workspaceId, {
    type: "feedback-item:deleted",
    payload: {
      feedbackItemId: args.feedbackItemId,
    },
  });
};

export const broadcastFeedbackCommentCreated = (args: {
  feedbackItemId: string;
  commentId: string;
  workspaceId?: string | null;
}) => {
  if (!args.workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(args.workspaceId, {
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
  workspaceId?: string | null;
}) => {
  if (!args.workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(args.workspaceId, {
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
  workspaceId?: string | null;
}) => {
  if (!args.workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(args.workspaceId, {
    type: "feedback-comment:deleted",
    payload: {
      feedbackItemId: args.feedbackItemId,
      commentId: args.commentId,
    },
  });
};
