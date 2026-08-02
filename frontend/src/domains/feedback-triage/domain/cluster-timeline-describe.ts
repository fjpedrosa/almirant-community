import type React from "react";
import {
  Plus,
  ArrowRight,
  PlayCircle,
  GitPullRequest,
  GitMerge,
  AlertCircle,
  Layers,
} from "lucide-react";
import {
  assertNeverEvent,
  type ClusterTimelineEvent,
  type ClusterTimelineEventKind,
} from "./cluster-timeline";

export interface TimelineEventDescriptor {
  kind: ClusterTimelineEventKind;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
}

/**
 * Presentation-agnostic descriptor for a single cluster timeline event.
 *
 * Kept separate from the renderer so the component and its tests share one
 * source of truth for the icon + label of every event kind. The returned
 * shape contains only primitives + a component reference, so it can be
 * asserted against directly in unit tests without rendering.
 */
export const describeTimelineEvent = (
  event: ClusterTimelineEvent,
): TimelineEventDescriptor => {
  switch (event.kind) {
    case "ticket_created":
      return {
        kind: event.kind,
        icon: Plus,
        iconClassName: "text-blue-500",
        label: "Ticket creado",
      };
    case "status_transition":
      return {
        kind: event.kind,
        icon: ArrowRight,
        iconClassName: "text-amber-500",
        label: `Transición: ${event.fromStatus ?? "inicial"} → ${event.toStatus}`,
      };
    case "attempt_launched":
      return {
        kind: event.kind,
        icon: PlayCircle,
        iconClassName: "text-indigo-500",
        label: `Intento #${event.attemptNumber} lanzado`,
      };
    case "pr_opened":
      return {
        kind: event.kind,
        icon: GitPullRequest,
        iconClassName: "text-blue-500",
        label: event.prNumber ? `PR #${event.prNumber} abierto` : "PR abierto",
      };
    case "pr_merged":
      return {
        kind: event.kind,
        icon: GitMerge,
        iconClassName: "text-violet-500",
        label: event.prNumber
          ? `PR #${event.prNumber} mergeado`
          : "PR mergeado",
      };
    case "regression_detected":
      return {
        kind: event.kind,
        icon: AlertCircle,
        iconClassName: "text-red-500",
        label: "Regresión detectada",
      };
    case "ticket_burst":
      return {
        kind: event.kind,
        icon: Layers,
        iconClassName: "text-slate-500",
        label: `${event.count} tickets creados`,
      };
    default:
      return assertNeverEvent(event);
  }
};
