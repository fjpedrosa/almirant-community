import type { Notification } from "./types";

export type NotificationKind =
  | "github_workflow_failure"
  | "github_workflow_success"
  | "github_check_run_failure"
  | "github_pr_review_approved"
  | "github_pr_review_changes_requested"
  | "github_pr_review_commented"
  | "github_pr_lifecycle"
  | "task_implementation_failed";

/** @deprecated Use NotificationKind instead */
export type GithubNotificationKind = NotificationKind;

export interface NotificationVisual {
  rowClass: string;
  iconContainerClass: string;
  iconClass: string;
  unreadDotClass: string;
  fallbackIcon: "alert" | "success" | "pr" | "comment" | "bell";
}

type PullRequestLifecycleState = "open" | "closed" | "merged";

export type NotificationToastType =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "merged";

const getPullRequestLifecycleStateFromMetadata = (
  metadata: Record<string, unknown> | undefined
): PullRequestLifecycleState | null => {
  const rawState = metadata?.prState;
  if (rawState === "open" || rawState === "closed" || rawState === "merged") {
    return rawState;
  }
  return null;
};

const getPullRequestLifecycleState = (
  notification: Notification
): PullRequestLifecycleState | null =>
  getPullRequestLifecycleStateFromMetadata(notification.metadata);

const getPullRequestDraftStateFromMetadata = (
  metadata: Record<string, unknown> | undefined
): boolean => {
  const rawDraft = metadata?.prDraft ?? metadata?.isDraft;
  if (typeof rawDraft === "boolean") return rawDraft;

  // GitHub sends these explicit lifecycle actions when a PR moves between
  // draft and review-ready while it is still open.
  if (metadata?.action === "converted_to_draft") return true;
  if (metadata?.action === "ready_for_review") return false;

  return false;
};

const knownKinds = new Set<NotificationKind>([
  "github_workflow_failure",
  "github_workflow_success",
  "github_check_run_failure",
  "github_pr_review_approved",
  "github_pr_review_changes_requested",
  "github_pr_review_commented",
  "github_pr_lifecycle",
  "task_implementation_failed",
]);

export const getNotificationKindFromMetadata = (
  metadata: Record<string, unknown> | undefined
): NotificationKind | null => {
  const rawKind = metadata?.kind;
  if (typeof rawKind !== "string") return null;

  return knownKinds.has(rawKind as NotificationKind)
    ? (rawKind as NotificationKind)
    : null;
};

export const getNotificationKind = (
  notification: Notification
): NotificationKind | null =>
  getNotificationKindFromMetadata(notification.metadata);

/** @deprecated Use getNotificationKind instead */
export const getGithubNotificationKind = getNotificationKind;

export const getNotificationToastTypeFromMetadata = (
  metadata: Record<string, unknown> | undefined
): NotificationToastType | null => {
  const kind = getNotificationKindFromMetadata(metadata);
  if (!kind) return null;

  switch (kind) {
    case "github_workflow_failure":
    case "github_check_run_failure":
    case "task_implementation_failed":
      return "error";
    case "github_pr_review_changes_requested":
      return "warning";
    case "github_workflow_success":
    case "github_pr_review_approved":
      return "success";
    case "github_pr_review_commented":
      return "info";
    case "github_pr_lifecycle": {
      const prState = getPullRequestLifecycleStateFromMetadata(metadata);
      if (prState === "merged") return "merged";
      if (prState === "closed") return "error";
      if (prState === "open") {
        return getPullRequestDraftStateFromMetadata(metadata)
          ? "neutral"
          : "success";
      }
      return "info";
    }
    default:
      return "info";
  }
};

export const getNotificationVisual = (
  notification: Notification
): NotificationVisual => {
  const kind = getNotificationKind(notification);
  const prState = getPullRequestLifecycleState(notification);
  const prDraft = getPullRequestDraftStateFromMetadata(notification.metadata);

  switch (kind) {
    case "github_workflow_failure":
    case "github_check_run_failure":
    case "task_implementation_failed":
      return {
        rowClass: "border-l-2 border-l-red-500/60",
        iconContainerClass: "",
        iconClass: "text-red-700",
        unreadDotClass: "bg-red-600",
        fallbackIcon: "alert",
      };
    case "github_pr_review_changes_requested":
      return {
        rowClass: "border-l-2 border-l-amber-500/70",
        iconContainerClass: "",
        iconClass: "text-amber-700",
        unreadDotClass: "bg-amber-600",
        fallbackIcon: "alert",
      };
    case "github_workflow_success":
    case "github_pr_review_approved":
      return {
        rowClass: "border-l-2 border-l-emerald-500/60",
        iconContainerClass: "",
        iconClass: "text-emerald-700",
        unreadDotClass: "bg-emerald-600",
        fallbackIcon: "success",
      };
    case "github_pr_review_commented":
      return {
        rowClass: "border-l-2 border-l-blue-500/60",
        iconContainerClass: "",
        iconClass: "text-blue-700",
        unreadDotClass: "bg-blue-600",
        fallbackIcon: "comment",
      };
    case "github_pr_lifecycle":
      if (prState === "merged") {
        return {
          rowClass: "border-l-2 border-l-violet-500/60",
          iconContainerClass: "",
          iconClass: "text-violet-700",
          unreadDotClass: "bg-violet-600",
          fallbackIcon: "pr",
        };
      }

      if (prState === "closed") {
        return {
          rowClass: "border-l-2 border-l-red-500/60",
          iconContainerClass: "",
          iconClass: "text-red-700",
          unreadDotClass: "bg-red-600",
          fallbackIcon: "pr",
        };
      }

      if (prState === "open") {
        if (prDraft) {
          return {
            rowClass: "border-l-2 border-l-slate-500/60",
            iconContainerClass: "",
            iconClass: "text-slate-700",
            unreadDotClass: "bg-slate-600",
            fallbackIcon: "pr",
          };
        }

        return {
          rowClass: "border-l-2 border-l-emerald-500/60",
          iconContainerClass: "",
          iconClass: "text-emerald-700",
          unreadDotClass: "bg-emerald-600",
          fallbackIcon: "pr",
        };
      }

      return {
        rowClass: "border-l-2 border-l-slate-500/60",
        iconContainerClass: "",
        iconClass: "text-slate-700",
        unreadDotClass: "bg-slate-600",
        fallbackIcon: "pr",
      };
    default:
      return {
        rowClass: "",
        iconContainerClass: "",
        iconClass: "text-muted-foreground",
        unreadDotClass: "bg-primary",
        fallbackIcon: "bell",
      };
  }
};
