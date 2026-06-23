"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTabVisibility } from "../../application/hooks/use-tab-visibility";
import { useWebSocket } from "../../application/hooks/use-websocket";
import { WebSocketContext } from "../../application/hooks/use-ws-context";
import type { WsServerMessage } from "../../domain/ws-types";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { agentJobKeys } from "@/domains/agents/application/hooks/use-agent-jobs";
import { ideaKeys } from "@/domains/ideas/application/hooks/use-ideas";
import { commentKeys } from "@/domains/ideas/application/hooks/use-idea-item-comments";
import { notificationKeys } from "@/domains/notifications/application/hooks/use-notifications";
import { getNotificationToastTypeFromMetadata } from "@/domains/notifications/domain/notification-visuals";
import { sessionKeys } from "@/domains/sessions/domain/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
};

const formatCost = (cost: string): string => {
  const n = parseFloat(cost);
  if (Number.isNaN(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};

const formatDuration = (ms: number | null): string => {
  const v = ms ?? 0;
  if (v <= 0) return "0s";
  const seconds = Math.floor(v / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

// @ce-patch: inline feedbackKeys (public CE has no feedback domain)
const feedbackKeys = {
  all: ["backoffice", "feedback"] as const,
  items: () => [...feedbackKeys.all, "items"] as const,
  item: (id: string) => [...feedbackKeys.items(), id] as const,
  traceability: (feedbackItemId: string) =>
    [...feedbackKeys.all, "traceability", feedbackItemId] as const,
  comments: (feedbackItemId: string) =>
    [...feedbackKeys.all, "comments", feedbackItemId] as const,
};

const OPEN_WORK_ITEM_EVENT = "mc:open-work-item";

/** Stable toast ID for agent interaction questions — reusing the same ID
 *  makes Sonner replace the existing toast instead of stacking a new one. */
const INTERACTION_TOAST_ID = "agent-interaction-question";

export const WebSocketProvider = ({ children }: { children: ReactNode }) => {
  const ws = useWebSocket();
  const queryClient = useQueryClient();
  const t = useTranslations("notifications");
  const { confirmedActiveTeamId } = useActiveTeam();

  // Extract stable subscribe function to avoid re-subscribing when ws.status changes.
  // ws.subscribe is stable (created with useCallback + empty deps) so the ref always
  // holds the same function, but using a ref decouples the subscription effects from
  // the ws object reference which changes on every status transition.
  const subscribeRef = useRef(ws.subscribe);
  const queryClientRef = useRef(queryClient);
  const tRef = useRef(t);
  const reconnectRef = useRef(ws.reconnect);
  const prevTeamIdRef = useRef<string | null>(null);

  useEffect(() => {
    subscribeRef.current = ws.subscribe;
    queryClientRef.current = queryClient;
    tRef.current = t;
    reconnectRef.current = ws.reconnect;
  });

  // Invalidate critical queries when tab returns after being hidden for 30+ seconds
  useTabVisibility({
    onReturn: () => {
      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["boards"] });
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.all });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.all });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.all });
      // Planning session list/detail consumers must refetch coherently after
      // returning to the tab. This complements the RECOVER_SESSION effect in
      // usePlanningSession and avoids acting on stale cached session state
      // while the WS reconnect replays buffered planning:* events.
      queryClientRef.current.invalidateQueries({ queryKey: ["planning-sessions"] });
      // Trigger WS reconnect to ensure connection is alive
      reconnectRef.current();
    },
  });

  // Reconnect WebSocket when the confirmed organization changes.
  // This ensures the WS connection uses the new session token with the updated org.
  useEffect(() => {
    // Skip on initial mount (prevTeamIdRef is null)
    if (prevTeamIdRef.current === null) {
      prevTeamIdRef.current = confirmedActiveTeamId;
      return;
    }

    // Only reconnect if the team actually changed
    if (confirmedActiveTeamId && confirmedActiveTeamId !== prevTeamIdRef.current) {
      reconnectRef.current();
    }

    prevTeamIdRef.current = confirmedActiveTeamId;
  }, [confirmedActiveTeamId]);

  // Subscribe to work-item:created to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("work-item:created", (message: WsServerMessage) => {
      if (message.type !== "work-item:created") return;

      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["boards"] });

      const label = message.payload.taskId
        ? `${message.payload.taskId}: ${message.payload.title}`
        : message.payload.title;
      showToast.success(tRef.current("workItemCreated", { label }));
    });

    return unsubscribe;
  }, []);

  // Subscribe to work-item:updated to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("work-item:updated", (message: WsServerMessage) => {
      if (message.type !== "work-item:updated") return;

      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });

      const changes = message.payload.changes;
      const changeKeys = Object.keys(changes);

      if (changeKeys.includes("boardColumnId")) {
        showToast.info(tRef.current("workItemMovedColumn"));
      } else if (changeKeys.includes("generatedPrompt")) {
        // AI prompt saved - already handled by AI flow, skip toast
      } else if (changeKeys.length === 1 && changeKeys[0] === "metadata") {
        // Metadata-only updates (e.g. checklist toggle) - skip toast
      } else {
        showToast.info(tRef.current("workItemUpdated"));
      }
    });

    return unsubscribe;
  }, []);

  // Subscribe to work-item:deleted to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("work-item:deleted", (message: WsServerMessage) => {
      if (message.type !== "work-item:deleted") return;

      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["boards"] });

      showToast.warning(tRef.current("workItemDeleted"));
    });

    return unsubscribe;
  }, []);

  // Subscribe to work-item:review-completed to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("work-item:review-completed", (message: WsServerMessage) => {
      if (message.type !== "work-item:review-completed") return;

      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });

      const { payload } = message;
      const label = payload.taskId ?? payload.title;

      if (payload.result === "pass") {
        showToast.success(tRef.current("reviewPassed", { label, targetColumn: payload.targetColumn }));
      } else {
        showToast.warning(tRef.current("reviewFailed", { label, targetColumn: payload.targetColumn }));
      }
    });

    return unsubscribe;
  }, []);

  // Subscribe to agent-job:status-changed so board indicators update in real time.
  useEffect(() => {
    const unsubscribe = subscribeRef.current("agent-job:status-changed", (message: WsServerMessage) => {
      if (message.type !== "agent-job:status-changed") return;

      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.all });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.lists() });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.detail(message.payload.jobId) });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.output(message.payload.jobId) });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.sessionEvents(message.payload.jobId) });
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.interactions(message.payload.jobId) });

      if (message.payload.workItemId) {
        queryClientRef.current.invalidateQueries({ queryKey: workItemKeys.detail(message.payload.workItemId) });
      }
    });

    return unsubscribe;
  }, []);

  // Subscribe to agent-job:log-batch to invalidate session output caches
  useEffect(() => {
    const unsubscribe = subscribeRef.current("agent-job:log-batch", (message: WsServerMessage) => {
      if (message.type !== "agent-job:log-batch") return;
      queryClientRef.current.invalidateQueries({ queryKey: sessionKeys.output(message.payload.jobId) });
    });
    return unsubscribe;
  }, []);

  // Subscribe to ai:session-recorded to invalidate caches + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("ai:session-recorded", (message: WsServerMessage) => {
      if (message.type !== "ai:session-recorded") return;

      const { payload } = message;

      queryClientRef.current.invalidateQueries({ queryKey: workItemKeys.detail(payload.workItemId) });
      queryClientRef.current.invalidateQueries({
        queryKey: [...workItemKeys.detail(payload.workItemId), "ai-sessions"],
      });

      const label = payload.taskId
        ? `${payload.taskId}: ${payload.title ?? payload.workItemId}`
        : payload.title ?? payload.workItemId;

      showToast.info(
        tRef.current("aiSessionRecorded", {
          label,
          model: payload.model,
          cost: formatCost(payload.estimatedCost),
          duration: formatDuration(payload.durationMs),
          tokens: formatTokens(payload.totalTokens),
        }),
        {
          duration: 8000,
          action: {
            label: "Open",
            onClick: () => {
              window.dispatchEvent(
                new CustomEvent(OPEN_WORK_ITEM_EVENT, {
                  detail: { workItemId: payload.workItemId },
                })
              );
            },
          },
        }
      );
    });

    return unsubscribe;
  }, []);

  // Subscribe to worker:interaction-created to show persistent toast + invalidate caches
  useEffect(() => {
    const unsubscribe = subscribeRef.current("worker-interaction:created", (message: WsServerMessage) => {
      if (message.type !== "worker-interaction:created") return;

      const { payload } = message;

      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.workItemInteractions(payload.workItemId) });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.pendingCount() });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.all });
      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });
    });

    return unsubscribe;
  }, []);

  // Subscribe to worker:interaction-responded to dismiss toast + invalidate caches
  useEffect(() => {
    const unsubscribe = subscribeRef.current("worker-interaction:responded", (message: WsServerMessage) => {
      if (message.type !== "worker-interaction:responded") return;

      const { payload } = message;

      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.workItemInteractions(payload.workItemId) });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.pendingCount() });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.all });

      showToast.dismiss(INTERACTION_TOAST_ID);
    });

    return unsubscribe;
  }, []);

  // Subscribe to idea-item:created to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("idea-item:created", (message: WsServerMessage) => {
      if (message.type !== "idea-item:created") return;

      queryClientRef.current.invalidateQueries({ queryKey: ideaKeys.all });
      showToast.success(tRef.current("ideaItemCreated", { title: message.payload.title }));
    });

    return unsubscribe;
  }, []);

  // Subscribe to idea-item:updated to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("idea-item:updated", (message: WsServerMessage) => {
      if (message.type !== "idea-item:updated") return;

      queryClientRef.current.invalidateQueries({ queryKey: ideaKeys.all });
      showToast.info(tRef.current("ideaItemUpdated"));
    });

    return unsubscribe;
  }, []);

  // Subscribe to idea-item:deleted to invalidate React Query cache + notify
  useEffect(() => {
    const unsubscribe = subscribeRef.current("idea-item:deleted", (message: WsServerMessage) => {
      if (message.type !== "idea-item:deleted") return;

      queryClientRef.current.invalidateQueries({ queryKey: ideaKeys.all });
      showToast.warning(tRef.current("ideaItemDeleted"));
    });

    return unsubscribe;
  }, []);

  // Subscribe to worker:interaction-expired to dismiss toast + invalidate caches + warn
  useEffect(() => {
    const unsubscribe = subscribeRef.current("worker-interaction:expired", (message: WsServerMessage) => {
      if (message.type !== "worker-interaction:expired") return;

      const { payload } = message;

      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.workItemInteractions(payload.workItemId) });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.pendingCount() });
      queryClientRef.current.invalidateQueries({ queryKey: agentJobKeys.all });

      showToast.dismiss(INTERACTION_TOAST_ID);
      showToast.warning(tRef.current("interactionExpired"));
    });

    return unsubscribe;
  }, []);

  // Subscribe to idea-comment events to invalidate comment caches in real time
  useEffect(() => {
    const unsub1 = subscribeRef.current("idea-comment:created", (message: WsServerMessage) => {
      if (message.type !== "idea-comment:created") return;
      queryClientRef.current.invalidateQueries({
        queryKey: commentKeys.all(message.payload.ideaItemId),
      });
      queryClientRef.current.invalidateQueries({ queryKey: ideaKeys.all });
    });

    const unsub2 = subscribeRef.current("idea-comment:updated", (message: WsServerMessage) => {
      if (message.type !== "idea-comment:updated") return;
      queryClientRef.current.invalidateQueries({
        queryKey: commentKeys.all(message.payload.ideaItemId),
      });
    });

    const unsub3 = subscribeRef.current("idea-comment:deleted", (message: WsServerMessage) => {
      if (message.type !== "idea-comment:deleted") return;
      queryClientRef.current.invalidateQueries({
        queryKey: commentKeys.all(message.payload.ideaItemId),
      });
      queryClientRef.current.invalidateQueries({ queryKey: ideaKeys.all });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // Subscribe to notification:new to invalidate notification caches + show toast
  useEffect(() => {
    const unsubscribe = subscribeRef.current("notification:new", (message: WsServerMessage) => {
      if (message.type !== "notification:new") return;

      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.unreadCount });
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.all });

      const toastType = getNotificationToastTypeFromMetadata(
        message.payload.metadata
      );

      if (!toastType) {
        showToast.info(tRef.current("newNotification", { title: message.payload.title }));
        return;
      }

      // GitHub events affect work item metadata (PR status, CI status).
      // Agent job failures also affect work item state.
      // The work-item:updated WS event may arrive late or not at all, so proactively invalidate here.
      queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });

      const toastOptions = { description: message.payload.body ?? undefined };
      showToast[toastType](message.payload.title, toastOptions);
    });

    return unsubscribe;
  }, []);

  // Subscribe to notification:read and notification:read-all to update unread count
  useEffect(() => {
    const unsub1 = subscribeRef.current("notification:read", (message: WsServerMessage) => {
      if (message.type !== "notification:read") return;
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.unreadCount });
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.all });
    });

    const unsub2 = subscribeRef.current("notification:read-all", (message: WsServerMessage) => {
      if (message.type !== "notification:read-all") return;
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.unreadCount });
      queryClientRef.current.invalidateQueries({ queryKey: notificationKeys.all });
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  // Subscribe to seed:created/updated/deleted to invalidate React Query caches
  useEffect(() => {
    const unsub1 = subscribeRef.current("seed:created", (message: WsServerMessage) => {
      if (message.type !== "seed:created") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["seeds"] });
    });

    const unsub2 = subscribeRef.current("seed:updated", (message: WsServerMessage) => {
      if (message.type !== "seed:updated") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["seeds"] });
    });

    const unsub3 = subscribeRef.current("seed:deleted", (message: WsServerMessage) => {
      if (message.type !== "seed:deleted") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["seeds"] });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // Subscribe to planning-session:created/updated/completed to invalidate React Query caches
  useEffect(() => {
    const unsub1 = subscribeRef.current("planning-session:created", (message: WsServerMessage) => {
      if (message.type !== "planning-session:created") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["planning-sessions"] });
    });

    const unsub2 = subscribeRef.current("planning-session:updated", (message: WsServerMessage) => {
      if (message.type !== "planning-session:updated") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["planning-sessions"] });
    });

    const unsub3 = subscribeRef.current("planning-session:completed", (message: WsServerMessage) => {
      if (message.type !== "planning-session:completed") return;
      queryClientRef.current.invalidateQueries({ queryKey: ["planning-sessions"] });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // Subscribe to feedback item events so backoffice feedback stays in sync in real time
  useEffect(() => {
    const unsub1 = subscribeRef.current("feedback-item:created", (message: WsServerMessage) => {
      if (message.type !== "feedback-item:created") return;
      queryClientRef.current.invalidateQueries({ queryKey: feedbackKeys.items() });
    });

    const unsub2 = subscribeRef.current("feedback-item:updated", (message: WsServerMessage) => {
      if (message.type !== "feedback-item:updated") return;
      queryClientRef.current.invalidateQueries({ queryKey: feedbackKeys.items() });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.item(message.payload.feedbackItemId),
      });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.traceability(message.payload.feedbackItemId),
      });
    });

    const unsub3 = subscribeRef.current("feedback-item:deleted", (message: WsServerMessage) => {
      if (message.type !== "feedback-item:deleted") return;
      queryClientRef.current.invalidateQueries({ queryKey: feedbackKeys.items() });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.item(message.payload.feedbackItemId),
      });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.traceability(message.payload.feedbackItemId),
      });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.comments(message.payload.feedbackItemId),
      });
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // Subscribe to feedback comment events so open detail panels refresh without manual reload
  useEffect(() => {
    const invalidateFeedbackComments = (feedbackItemId: string) => {
      queryClientRef.current.invalidateQueries({ queryKey: feedbackKeys.items() });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.item(feedbackItemId),
      });
      queryClientRef.current.invalidateQueries({
        queryKey: feedbackKeys.comments(feedbackItemId),
      });
    };

    const unsub1 = subscribeRef.current("feedback-comment:created", (message: WsServerMessage) => {
      if (message.type !== "feedback-comment:created") return;
      invalidateFeedbackComments(message.payload.feedbackItemId);
    });

    const unsub2 = subscribeRef.current("feedback-comment:updated", (message: WsServerMessage) => {
      if (message.type !== "feedback-comment:updated") return;
      invalidateFeedbackComments(message.payload.feedbackItemId);
    });

    const unsub3 = subscribeRef.current("feedback-comment:deleted", (message: WsServerMessage) => {
      if (message.type !== "feedback-comment:deleted") return;
      invalidateFeedbackComments(message.payload.feedbackItemId);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // Subscribe to connection:updated to keep integrations/github/onboarding state in sync
  useEffect(() => {
    const unsubscribe = subscribeRef.current("connection:updated", (message: WsServerMessage) => {
      if (message.type !== "connection:updated") return;
      if (message.payload.provider !== "github") return;

      queryClientRef.current.invalidateQueries({ queryKey: ["connections"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["github"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["onboarding"] });
    });

    return unsubscribe;
  }, []);

  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  );
};
