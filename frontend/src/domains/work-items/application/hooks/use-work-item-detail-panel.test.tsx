import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemWithRelations } from "../../domain/types";

/**
 * Scheduled work items (backend gate #47, "feat(agents): gate backlog drain by
 * start date and assigned agent"): the detail-panel edit flow must be able to
 * set AND clear `startDate`, mirroring the existing `dueDate` handler exactly.
 *
 * `useWorkItemDetailPanel` composes `useParentDetailPanel`, which pulls in
 * `next/navigation` (`useRouter`/`usePathname`/`useSearchParams`) via
 * `useDetailPanelUrl` — not mountable in a bare hook-test harness. Every
 * sibling hook is mocked out here so this test exercises ONLY the new
 * start-date wiring, through the real `useUpdateWorkItem` mutation (so the
 * PATCH payload shape is verified end-to-end, not just the callback wiring).
 */

const baseItem = {
  id: "wi-1",
  boardId: "board-1",
  projectId: "project-1",
  startDate: null,
  metadata: {},
  assignees: [],
  tags: [],
} as unknown as WorkItemWithRelations;

let currentParentItem: WorkItemWithRelations | null = baseItem;

// The real `@/lib/auth-client` throws at import when NEXT base URL is null
// (mirrors the mock setup in use-work-items.test.tsx / use-work-item-board.test.tsx).
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: {
      setActive: async () => ({ error: null }),
    },
  },
}));

mock.module("./use-parent-detail-panel", () => ({
  useParentDetailPanel: () => ({
    isOpen: true,
    openPanel: () => {},
    closePanel: () => {},
    navigateTo: () => {},
    goBack: () => {},
    canGoBack: false,
    parentItem: currentParentItem,
    isLoadingParent: false,
    children: [],
    isLoadingChildren: false,
    activeTab: "details",
    setActiveTab: () => {},
    childrenEvents: [],
    isLoadingChildrenEvents: false,
    ownEvents: [],
    isLoadingOwnEvents: false,
    showAll: false,
    toggleShowAll: () => {},
    moveChild: () => {},
    executionOriginData: {
      lastOrigin: null,
      activeRun: null,
      sessionSummary: null,
      isLoading: false,
    },
  }),
}));

mock.module("./use-work-item-board", () => ({
  useWorkItemsByBoard: () => ({ data: [], isLoading: false }),
  useMoveWorkItem: () => ({ mutate: () => {}, isPending: false }),
}));

mock.module("./use-parent-candidates", () => ({
  useParentCandidates: () => ({ parents: [], isLoading: false }),
}));

mock.module("@/domains/tags/application/hooks/use-tags", () => ({
  useTags: () => ({ data: [], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: async () => ({ id: "tag-1" }) }),
}));

mock.module("@/domains/teams/application/hooks/use-team-members-select", () => ({
  useTeamMembersSelect: () => ({ members: [], hasActiveTeam: false }),
}));

mock.module("./use-ai-format-text", () => ({
  useAiFormatText: () => ({ mutate: () => {}, isPending: false, variables: undefined }),
}));

const updateSpy = mock(async (_id: string, _data: unknown) => ({}) as unknown);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    workItemsApi: {
      ...realApi.workItemsApi,
      update: updateSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  updateSpy.mockClear();
  currentParentItem = baseItem;
});

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

describe("useWorkItemDetailPanel — start date edit (set/clear)", () => {
  it("fijar: handleStartDateChange sends the ISO string for a picked date", async () => {
    currentParentItem = baseItem;
    const { useWorkItemDetailPanel } = await import("./use-work-item-detail-panel");
    const { result } = renderHook(() => useWorkItemDetailPanel(), {
      wrapper: wrapperFor(makeClient()),
    });

    expect(result.current.startDate).toBeNull();

    result.current.handleStartDateChange(new Date("2026-09-01T00:00:00.000Z"));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith("wi-1", {
      startDate: "2026-09-01T00:00:00.000Z",
    });
  });

  it("limpiar: handleStartDateChange(null) sends null to clear the schedule", async () => {
    currentParentItem = {
      ...baseItem,
      startDate: new Date("2026-09-01T00:00:00.000Z"),
    } as unknown as WorkItemWithRelations;
    const { useWorkItemDetailPanel } = await import("./use-work-item-detail-panel");
    const { result } = renderHook(() => useWorkItemDetailPanel(), {
      wrapper: wrapperFor(makeClient()),
    });

    expect(result.current.startDate).toEqual(new Date("2026-09-01T00:00:00.000Z"));

    result.current.handleStartDateChange(null);

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith("wi-1", { startDate: null });
  });

  it("no-ops when there is no item loaded yet", async () => {
    currentParentItem = null;
    const { useWorkItemDetailPanel } = await import("./use-work-item-detail-panel");
    const { result } = renderHook(() => useWorkItemDetailPanel(), {
      wrapper: wrapperFor(makeClient()),
    });

    result.current.handleStartDateChange(new Date("2026-09-01T00:00:00.000Z"));

    await new Promise((r) => setTimeout(r, 25));
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
