import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectDevFlowAdoptResult, ProjectDevFlowConfigResponse } from "../../domain/types";

// `./use-projects` (source of `projectKeys`) pulls in `useActiveTeam` at
// module scope, which imports the real Better-Auth client — so it must only
// ever be imported dynamically, AFTER the `@/lib/auth-client` mock below is
// in effect. Never add a static top-level `import ... from "./use-projects"`
// to this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let projectKeys: any;

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

const adoptResult: ProjectDevFlowAdoptResult = {
  disabledUserConfigIds: ["user-agent-1"],
  automation: {
    automationId: "release-integration",
    targetConfigKey: "releaseIntegration",
    name: "Release integration",
    description: "d",
    configId: "agent-4",
    managedBy: "system",
    enabled: true,
    lastRunAt: null,
    skippedForExistingUserAgent: false,
    overrides: null,
    effective: {
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-5",
      reasoningLevel: "high",
      maxConcurrentJobs: 2,
      schedule: { expression: "*/5 * * * *", timezone: "UTC" },
    },
  },
};

const adoptAutomationSpy = mock(async (_projectId: string, _automationId: string) => adoptResult);

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      adoptAutomation: adoptAutomationSpy,
    },
  }));
  ({ projectKeys } = await import("./use-projects"));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  adoptAutomationSpy.mockClear();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
    }
  >
    {children}
  </QueryClientProvider>
);

// Some tests need to seed/inspect the cache directly (to prove the adopt
// response is reflected immediately, not only after the invalidated query
// refetches) — those build their own client + wrapper instead of the shared
// one above, so the test can hold a reference to it.
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
};

describe("useDevFlowAdopt", () => {
  it("isAdopting is false for every automation before any adopt is requested", async () => {
    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-1"), { wrapper });

    expect(result.current.isAdopting("release-integration")).toBe(false);
  });

  it("handleAdopt calls devFlowApi.adoptAutomation with the projectId and automationId", async () => {
    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-2"), { wrapper });

    act(() => {
      result.current.handleAdopt("release-integration");
    });

    await waitFor(() => expect(adoptAutomationSpy).toHaveBeenCalledWith("proj-2", "release-integration"));
  });

  it("isAdopting is true only for the automation currently being adopted", async () => {
    let resolveAdopt: (() => void) | null = null;
    adoptAutomationSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdopt = () => resolve(adoptResult);
        }),
    );

    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-3"), { wrapper });

    act(() => {
      result.current.handleAdopt("release-integration");
    });

    await waitFor(() => expect(result.current.isAdopting("release-integration")).toBe(true));
    expect(result.current.isAdopting("backlog-drain")).toBe(false);

    resolveAdopt!();
    await waitFor(() => expect(adoptAutomationSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isAdopting("release-integration")).toBe(false));
  });

  it("reflects the adopt response's automation (enabled: true) into the devFlow cache immediately, independent of the card master switch", async () => {
    // Adopt forces enabled=true on the adopted automation directly in its
    // config, even when the card-level master switch is off — the row must
    // show that real state as soon as the response comes back, not only
    // after the invalidated query happens to refetch.
    const { client, Wrapper } = createWrapper();
    const initialData: ProjectDevFlowConfigResponse = {
      devFlow: {
        enabled: false, // master switch OFF
        codingAgent: null,
        aiProvider: null,
        model: null,
        reasoningLevel: null,
        maxConcurrentJobs: null,
      },
      automations: [
        {
          automationId: "release-integration",
          targetConfigKey: "releaseIntegration",
          name: "Release integration",
          description: "d",
          configId: null,
          managedBy: null,
          enabled: false,
          lastRunAt: null,
          skippedForExistingUserAgent: true,
          overrides: null,
          effective: adoptResult.automation.effective,
        },
      ],
      skippedExistingUserAgents: [{ configId: "user-agent-1", automationId: "release-integration" }],
    };
    client.setQueryData(projectKeys.devFlow("proj-4"), initialData);

    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-4"), { wrapper: Wrapper });

    act(() => {
      result.current.handleAdopt("release-integration");
    });

    await waitFor(() => expect(adoptAutomationSpy).toHaveBeenCalledTimes(1));

    const cached = client.getQueryData<ProjectDevFlowConfigResponse>(projectKeys.devFlow("proj-4"));
    const row = cached?.automations.find((a) => a.automationId === "release-integration");
    expect(row?.enabled).toBe(true);
    expect(row?.skippedForExistingUserAgent).toBe(false);
    expect(row?.configId).toBe("agent-4");
    // The master switch itself is untouched by adopt.
    expect(cached?.devFlow?.enabled).toBe(false);
  });

  it("removes the adopted automation's disabled user agent(s) from skippedExistingUserAgents in the cache", async () => {
    const { client, Wrapper } = createWrapper();
    const initialData: ProjectDevFlowConfigResponse = {
      devFlow: { enabled: true, codingAgent: null, aiProvider: null, model: null, reasoningLevel: null, maxConcurrentJobs: null },
      automations: [
        {
          automationId: "release-integration",
          targetConfigKey: "releaseIntegration",
          name: "Release integration",
          description: "d",
          configId: null,
          managedBy: null,
          enabled: false,
          lastRunAt: null,
          skippedForExistingUserAgent: true,
          overrides: null,
          effective: adoptResult.automation.effective,
        },
        {
          automationId: "backlog-drain",
          targetConfigKey: "backlogDrain",
          name: "Backlog drain",
          description: "d",
          configId: "agent-1",
          managedBy: "system",
          enabled: true,
          lastRunAt: null,
          skippedForExistingUserAgent: false,
          overrides: null,
          effective: adoptResult.automation.effective,
        },
      ],
      skippedExistingUserAgents: [
        { configId: "user-agent-1", automationId: "release-integration" },
        { configId: "user-agent-2", automationId: "dod-review" },
      ],
    };
    client.setQueryData(projectKeys.devFlow("proj-5"), initialData);

    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-5"), { wrapper: Wrapper });

    act(() => {
      result.current.handleAdopt("release-integration");
    });

    await waitFor(() => expect(adoptAutomationSpy).toHaveBeenCalledTimes(1));

    const cached = client.getQueryData<ProjectDevFlowConfigResponse>(projectKeys.devFlow("proj-5"));
    // Only the disabled configId ("user-agent-1") is removed — the unrelated
    // "user-agent-2" conflict on a different automation stays as-is.
    expect(cached?.skippedExistingUserAgents).toEqual([{ configId: "user-agent-2", automationId: "dod-review" }]);
    // The other row is untouched.
    expect(cached?.automations.find((a) => a.automationId === "backlog-drain")).toEqual(initialData.automations[1]);
  });

  it("still invalidates the devFlow and ai-config queries after the optimistic cache update, for eventual consistency", async () => {
    const { client, Wrapper } = createWrapper();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;
    client.setQueryData(projectKeys.devFlow("proj-6"), {
      devFlow: null,
      automations: [],
      skippedExistingUserAgents: [],
    } satisfies ProjectDevFlowConfigResponse);

    const { useDevFlowAdopt } = await import("./use-dev-flow-adopt");
    const { result } = renderHook(() => useDevFlowAdopt("proj-6"), { wrapper: Wrapper });

    act(() => {
      result.current.handleAdopt("release-integration");
    });

    await waitFor(() => expect(adoptAutomationSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: projectKeys.devFlow("proj-6") }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: projectKeys.aiConfig("proj-6") });
  });
});
