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
 * Change 1 (org-gate): the participants query must not fire until the active
 * org is confirmed, on top of its existing `normalizedIds.length > 0` guard.
 */

let mockConfirmedTeamId: string | null = null;

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

const getParticipants = mock(async () => ({}) as Record<string, unknown>);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    workItemsApi: {
      ...realApi.workItemsApi,
      getParticipants,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  getParticipants.mockClear();
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

describe("useWorkItemParticipants (org-gate)", () => {
  it("does NOT fire while the active org is unconfirmed (even with ids present)", async () => {
    mockConfirmedTeamId = null;
    const { useWorkItemParticipants } = await import(
      "./use-work-item-participants"
    );

    const { result } = renderHook(
      () => useWorkItemParticipants(["wi-1", "wi-2"]),
      { wrapper: createWrapper() },
    );

    await tick();
    expect(getParticipants).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fires once the active org is confirmed and ids are present", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemParticipants } = await import(
      "./use-work-item-participants"
    );

    renderHook(() => useWorkItemParticipants(["wi-1", "wi-2"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(getParticipants).toHaveBeenCalledTimes(1));
  });

  it("stays idle with a confirmed org but no ids", async () => {
    mockConfirmedTeamId = "team-1";
    const { useWorkItemParticipants } = await import(
      "./use-work-item-participants"
    );

    const { result } = renderHook(() => useWorkItemParticipants([]), {
      wrapper: createWrapper(),
    });

    await tick();
    expect(getParticipants).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});
