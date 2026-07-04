import React from "react";
import { describe, expect, it, mock } from "bun:test";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Bun's `mock.module` is global and persists across test files within a run.
// Mocking `@tanstack/react-query` here would leak `useQueryClient` into
// unrelated tests (e.g. `useMutation` callers that rely on a real
// QueryClient). Use a real QueryClient and spy on its `invalidateQueries`
// instead so the scope stays local to this file.
const invalidateQueries = mock(() => Promise.resolve());
const subscribers = new Map<string, Set<(message: unknown) => void>>();
const feedbackKeys = {
  items: () => ["backoffice", "feedback", "items"] as const,
  item: (id: string) => ["backoffice", "feedback", "items", id] as const,
  traceability: (feedbackItemId: string) =>
    ["backoffice", "feedback", "traceability", feedbackItemId] as const,
  comments: (feedbackItemId: string) =>
    ["backoffice", "feedback", "comments", feedbackItemId] as const,
};

// NOTE: We intentionally do NOT mock `use-work-items` here. Bun's `mock.module`
// is global and leaks across files; a partial stub of `use-work-items` (missing
// its hooks) poisoned the real work-items hook tests. This test never asserts on
// work-item query keys, so it uses the real module — the auth-client mock below
// keeps the import chain (query-keys -> use-active-team -> auth-client) from
// throwing on a null base URL.

mock.module("@/domains/agents/application/hooks/use-agent-jobs", () => ({
  agentJobKeys: {
    all: ["agent-jobs"] as const,
    pendingCount: () => ["agent-jobs", "pending-count"] as const,
    workItemInteractions: (workItemId: string) =>
      ["agent-jobs", "work-item-interactions", workItemId] as const,
  },
}));

mock.module("@/domains/ideas/application/hooks/use-ideas", () => ({
  ideaKeys: {
    all: ["ideas"] as const,
  },
}));

mock.module("@/domains/ideas/application/hooks/use-idea-item-comments", () => ({
  commentKeys: {
    all: (ideaItemId: string) => ["idea-comments", ideaItemId] as const,
  },
}));

mock.module("@/domains/notifications/application/hooks/use-notifications", () => ({
  notificationKeys: {
    all: ["notifications"] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },
}));

mock.module("@/domains/sessions/domain/query-keys", () => ({
  sessionKeys: {
    all: ["sessions"] as const,
    lists: () => ["sessions", "lists"] as const,
    detail: (id: string) => ["sessions", "detail", id] as const,
    output: (id: string) => ["sessions", "output", id] as const,
    sessionEvents: (id: string) => ["sessions", "events", id] as const,
    interactions: (id: string) => ["sessions", "interactions", id] as const,
  },
}));

mock.module("@/domains/feedback/application/hooks/use-feedback-traceability", () => ({
  feedbackKeys,
  useFeedbackTraceability: () => ({
    data: {
      bugFixAttempts: [],
    },
  }),
}));

mock.module("next-intl", () => ({
  useTranslations: () => (_key: string, values?: Record<string, unknown>) =>
    values ? JSON.stringify(values) : "",
  useLocale: () => "en",
}));

mock.module("@/domains/shared/presentation/utils/show-toast", () => ({
  showToast: {
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
    dismiss: () => {},
  },
}));

mock.module("../../application/hooks/use-tab-visibility", () => ({
  useTabVisibility: () => {},
}));

mock.module("../../application/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    subscribe: (type: string, handler: (message: unknown) => void) => {
      if (!subscribers.has(type)) {
        subscribers.set(type, new Set());
      }
      subscribers.get(type)!.add(handler);
      return () => {
        subscribers.get(type)?.delete(handler);
      };
    },
    reconnect: () => {},
    sendMessage: () => {},
    status: "connected",
    isConnected: true,
  }),
}));

// Mock the better-auth client (not `use-active-team` itself) so the real
// useActiveTeam runs and resolves a confirmed org, without leaking a
// use-active-team stub into other files that render real work-item hooks.
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({
      data: { id: "team-1" },
      isPending: false,
    }),
    organization: {
      setActive: async () => ({ error: null }),
    },
  },
}));

describe("WebSocketProvider feedback realtime subscriptions", () => {
  it("invalidates feedback queries when a feedback item update arrives over WS", async () => {
    const { WebSocketProvider } = await import("./websocket-provider");

    const queryClient = new QueryClient();
    queryClient.invalidateQueries = invalidateQueries;

    render(
      <QueryClientProvider client={queryClient}>
        <WebSocketProvider>
          <div>child</div>
        </WebSocketProvider>
      </QueryClientProvider>
    );

    invalidateQueries.mockClear();

    await act(async () => {
      subscribers.get("feedback-item:updated")?.forEach((handler) =>
        handler({
          type: "feedback-item:updated",
          payload: {
            feedbackItemId: "feedback-1",
            changes: { status: "triaged" },
          },
        })
      );
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: feedbackKeys.items(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: feedbackKeys.item("feedback-1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: feedbackKeys.traceability("feedback-1"),
    });
  });
});
