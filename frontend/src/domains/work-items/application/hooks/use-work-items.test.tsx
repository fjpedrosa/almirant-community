import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Change 1 (org-gate): `useWorkItems` (the generic list query) must not fire
 * until the active org is confirmed.
 *
 * Change 2 (invalidation scoping): create/delete/resetAi must stop invalidating
 * the root key `workItemKeys.all` (which refetches the heavy board list plus
 * every other work-item query) and instead invalidate only the views they
 * actually affect — while STILL guaranteeing the board/area/list the user sees
 * refreshes.
 */

let mockConfirmedTeamId: string | null = "team-1";

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

mock.module("@/domains/shared/presentation/utils/show-toast", () => ({
  showToast: { success: () => {}, error: () => {} },
}));

const listSpy = mock(async () => [] as unknown[]);
const resetAiSpy = mock(async () => ({}) as unknown);
const createSpy = mock(async () => ({}) as unknown);
const deleteSpy = mock(async () => ({}) as unknown);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    workItemsApi: {
      ...realApi.workItemsApi,
      list: listSpy,
      resetAi: resetAiSpy,
      create: createSpy,
      delete: deleteSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  listSpy.mockClear();
  resetAiSpy.mockClear();
  createSpy.mockClear();
  deleteSpy.mockClear();
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

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

const invalidatedKeys = (spy: ReturnType<typeof spyOn>): string[] =>
  spy.mock.calls
    .map((call: unknown[]) => (call[0] as { queryKey?: unknown[] })?.queryKey)
    .filter(Boolean)
    .map((key: unknown) => JSON.stringify(key));

const hasKey = (keys: string[], expected: unknown[]) =>
  keys.includes(JSON.stringify(expected));

// -----------------------------------------------------------------------------
// Change 1: org-gate on the generic list query
// -----------------------------------------------------------------------------
describe("useWorkItems (org-gate)", () => {
  it("does NOT fire while the active org is unconfirmed", async () => {
    mockConfirmedTeamId = null;
    const { useWorkItems } = await import("./use-work-items");

    const { result } = renderHook(() => useWorkItems(), {
      wrapper: wrapperFor(makeClient()),
    });

    await tick();
    expect(listSpy).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fires once the active org is confirmed", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItems } = await import("./use-work-items");

    renderHook(() => useWorkItems(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));
  });
});

// -----------------------------------------------------------------------------
// Change 2: invalidation scoping (correction > perf — board must still refresh)
// -----------------------------------------------------------------------------
describe("useResetAiProcessing (scoped invalidation)", () => {
  it("invalidates board/area/list/detail, keeps the board fresh, and no longer nukes the root or participants", async () => {
    mockConfirmedTeamId = "team-1";
    const client = makeClient();

    // Active board + participants queries the user is currently seeing.
    const boardKey = ["work-items", "board", "b1", "", "org:team-1"];
    const participantsKey = ["work-items", "participants", "hash", "org:team-1"];
    client.setQueryData(boardKey, []);
    client.setQueryData(participantsKey, {});

    const invalidateSpy = spyOn(client, "invalidateQueries");

    const { useResetAiProcessing } = await import("./use-work-items");
    const { result } = renderHook(() => useResetAiProcessing(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync("wi-1");
    await tick();

    const keys = invalidatedKeys(invalidateSpy);
    // Narrowed set (mirror of useUpdateWorkItem).
    expect(hasKey(keys, ["work-items", "detail", "wi-1"])).toBe(true);
    expect(hasKey(keys, ["work-items", "list"])).toBe(true);
    expect(hasKey(keys, ["work-items", "board"])).toBe(true);
    expect(hasKey(keys, ["work-items", "byArea"])).toBe(true);
    // Must NOT nuke the whole namespace anymore.
    expect(hasKey(keys, ["work-items"])).toBe(false);

    // Correctness: the board the user sees still refreshes...
    expect(client.getQueryState(boardKey)?.isInvalidated).toBe(true);
    // ...but participants (untouched by an AI reset) is NOT needlessly refetched.
    expect(client.getQueryState(participantsKey)?.isInvalidated).toBe(false);
  });
});

describe("useCreateWorkItem (scoped invalidation)", () => {
  it("invalidates the structural views (board/area/list/children/hierarchy), keeps the board fresh, and no longer nukes the root", async () => {
    mockConfirmedTeamId = "team-1";
    const client = makeClient();

    const boardKey = ["work-items", "board", "b1", "", "org:team-1"];
    const areaKey = ["work-items", "byArea", "product", "", "org:team-1"];
    const participantsKey = ["work-items", "participants", "hash", "org:team-1"];
    client.setQueryData(boardKey, []);
    client.setQueryData(areaKey, []);
    client.setQueryData(participantsKey, {});

    const invalidateSpy = spyOn(client, "invalidateQueries");

    const { useCreateWorkItem } = await import("./use-work-items");
    const { result } = renderHook(() => useCreateWorkItem(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync(
      {} as Parameters<typeof result.current.mutateAsync>[0],
    );
    await tick();

    const keys = invalidatedKeys(invalidateSpy);
    expect(hasKey(keys, ["work-items", "list"])).toBe(true);
    expect(hasKey(keys, ["work-items", "board"])).toBe(true);
    expect(hasKey(keys, ["work-items", "byArea"])).toBe(true);
    // A create can add a child / new parent candidate — those panels must refresh.
    expect(hasKey(keys, ["work-items", "children"])).toBe(true);
    expect(hasKey(keys, ["work-items", "hierarchy"])).toBe(true);
    expect(hasKey(keys, ["work-items", "parent-candidates"])).toBe(true);
    expect(hasKey(keys, ["work-items"])).toBe(false);

    // Correctness: board + area the user sees refresh.
    expect(client.getQueryState(boardKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(areaKey)?.isInvalidated).toBe(true);
    // Participants not needlessly refetched (new item fetches under a fresh key).
    expect(client.getQueryState(participantsKey)?.isInvalidated).toBe(false);
  });
});

describe("useDeleteWorkItem (scoped invalidation)", () => {
  it("invalidates board/area/list/detail/children/hierarchy, keeps the board fresh, and no longer nukes the root", async () => {
    mockConfirmedTeamId = "team-1";
    const client = makeClient();

    const boardKey = ["work-items", "board", "b1", "", "org:team-1"];
    client.setQueryData(boardKey, []);

    const invalidateSpy = spyOn(client, "invalidateQueries");

    const { useDeleteWorkItem } = await import("./use-work-items");
    const { result } = renderHook(() => useDeleteWorkItem(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync("wi-1");
    await tick();

    const keys = invalidatedKeys(invalidateSpy);
    expect(hasKey(keys, ["work-items", "detail", "wi-1"])).toBe(true);
    expect(hasKey(keys, ["work-items", "list"])).toBe(true);
    expect(hasKey(keys, ["work-items", "board"])).toBe(true);
    expect(hasKey(keys, ["work-items", "byArea"])).toBe(true);
    expect(hasKey(keys, ["work-items", "children"])).toBe(true);
    expect(hasKey(keys, ["work-items", "hierarchy"])).toBe(true);
    expect(hasKey(keys, ["work-items"])).toBe(false);

    expect(client.getQueryState(boardKey)?.isInvalidated).toBe(true);
  });
});
