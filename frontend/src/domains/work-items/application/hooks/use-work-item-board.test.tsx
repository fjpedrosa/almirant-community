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
