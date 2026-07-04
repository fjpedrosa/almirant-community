import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Change 1 (org-gate): work-item board queries must NOT fire until the active
 * workspace/org is confirmed. Otherwise they fetch once under `org:none` and
 * refetch under `org:<id>` — the measured double fetch of the ~550KB board list.
 *
 * We mock `use-active-team` (the confirmed-org source, mirroring
 * use-view-preferences) so we can flip the confirmed id, and spy on the API
 * client to observe whether the query actually fires.
 */

// Controls the confirmed active org id, read by the real useActiveTeam through
// the mocked better-auth client (mirrors the api-keys container test setup).
let mockConfirmedTeamId: string | null = null;

// The real `@/lib/auth-client` throws at import when NEXT base URL is null, so
// (like the rest of the suite) we mock it rather than importing the real one.
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({
      data: mockConfirmedTeamId ? { id: mockConfirmedTeamId } : null,
      isPending: false,
    }),
    organization: {
      setActive: async () => ({ error: null }),
    },
  },
}));

const getByArea = mock(async () => [] as unknown[]);
const getByBoard = mock(async () => [] as unknown[]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    workItemsApi: {
      ...realApi.workItemsApi,
      getByArea,
      getByBoard,
    },
  }));
});

afterAll(() => {
  // Restore the real api client so the mock.module reg doesn't leak downstream.
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  getByArea.mockClear();
  getByBoard.mockClear();
});

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

describe("useWorkItemsByArea (org-gate)", () => {
  it("does NOT fire the query while the active org is unconfirmed", async () => {
    mockConfirmedTeamId = null;
    const { useWorkItemsByArea } = await import("./use-work-item-board");

    const { result } = renderHook(() => useWorkItemsByArea("area-1"), {
      wrapper: createWrapper(),
    });

    await tick();
    expect(getByArea).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fires the query once the active org is confirmed", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemsByArea } = await import("./use-work-item-board");

    renderHook(() => useWorkItemsByArea("area-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(getByArea).toHaveBeenCalledTimes(1));
  });
});

describe("useWorkItemsByArea SSR prefetch key contract (S6)", () => {
  // The board pages prefetch work-items server-side under
  //   orgScopedKey(workItemKeys.byAreaBase(area), orgId)
  // If the client hook registers a DIFFERENT query key, the dehydrated cache
  // misses on hydration and the client refetches the ~550KB board payload.
  // This pins: hook-registered key === server prefetch key. RED until both
  // sides route through the shared `workItemKeys.byAreaBase` builder.
  it("registers exactly the org-scoped byAreaBase key the server prefetch uses", async () => {
    mockConfirmedTeamId = "team-1";
    // Dynamic imports (like the rest of the suite) so the `@/lib/auth-client`
    // mock is registered before these modules transitively load it.
    const { useWorkItemsByArea } = await import("./use-work-item-board");
    const { orgScopedKey } = await import("@/lib/org-scoped-key");
    const { workItemKeys } = await import("./use-work-items");

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    // No filterParams — mirrors the clean first paint the SSR prefetch targets.
    renderHook(() => useWorkItemsByArea("desarrollo"), { wrapper });

    await waitFor(() =>
      expect(client.getQueryCache().getAll().length).toBeGreaterThan(0),
    );

    const registeredKey = client.getQueryCache().getAll()[0].queryKey;
    const serverPrefetchKey = orgScopedKey(
      workItemKeys.byAreaBase("desarrollo"),
      "team-1",
    );

    expect(registeredKey).toEqual(serverPrefetchKey);
    // Pin the concrete literal so neither side can silently change the shape.
    expect(registeredKey).toEqual([
      "work-items",
      "byArea",
      "desarrollo",
      "",
      "org:team-1",
    ]);
  });
});

describe("useWorkItemsByBoard (org-gate)", () => {
  it("does NOT fire the query while the active org is unconfirmed", async () => {
    mockConfirmedTeamId = null;
    const { useWorkItemsByBoard } = await import("./use-work-item-board");

    const { result } = renderHook(() => useWorkItemsByBoard("board-1"), {
      wrapper: createWrapper(),
    });

    await tick();
    expect(getByBoard).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fires the query once the active org is confirmed", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemsByBoard } = await import("./use-work-item-board");

    renderHook(() => useWorkItemsByBoard("board-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(getByBoard).toHaveBeenCalledTimes(1));
  });
});

describe("board hooks request the slim board DTO (?view=board)", () => {
  // Phase 5 (board perf): the board/area lists must ask the API for the slim
  // "board" view so the ~550KB payload drops description + heavy metadata blobs.
  it("useWorkItemsByArea passes the 'board' view to getByArea", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemsByArea } = await import("./use-work-item-board");

    renderHook(() => useWorkItemsByArea("desarrollo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(getByArea).toHaveBeenCalledTimes(1));
    expect(getByArea).toHaveBeenLastCalledWith("desarrollo", undefined, "board");
  });

  it("useWorkItemsByBoard passes the 'board' view to getByBoard", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemsByBoard } = await import("./use-work-item-board");

    renderHook(() => useWorkItemsByBoard("board-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(getByBoard).toHaveBeenCalledTimes(1));
    expect(getByBoard).toHaveBeenLastCalledWith("board-1", undefined, "board");
  });
});
