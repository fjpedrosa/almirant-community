import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test, mock } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ProjectDevFlowConfigResponse,
  ProjectDevFlowPatchBody,
} from "../../domain/types";

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

const baseResponse: ProjectDevFlowConfigResponse = {
  devFlow: {
    enabled: true,
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    model: "claude-opus-5",
    reasoningLevel: "high",
    maxConcurrentJobs: 2,
  },
  automations: [
    {
      automationId: "backlog-drain",
      targetConfigKey: "backlogDrain",
      name: "Backlog drain",
      description: "Picks ready Backlog work items.",
      configId: "agent-1",
      managedBy: "system",
      enabled: true,
      lastRunAt: null,
      skippedForExistingUserAgent: false,
      overrides: {
        enabled: null,
        codingAgent: null,
        aiProvider: null,
        model: "future-model",
        reasoningLevel: "future-effort",
        maxConcurrentJobs: null,
        schedule: null,
      },
      effective: {
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "future-model",
        reasoningLevel: "future-effort",
        maxConcurrentJobs: 2,
        schedule: { expression: "*/5 * * * *", timezone: "UTC" },
      },
    },
  ],
  skippedExistingUserAgents: [],
};

const getConfigSpy = mock(async (_projectId: string): Promise<ProjectDevFlowConfigResponse> => baseResponse);
const updateConfigSpy = mock(async (_projectId: string, _body: unknown) => ({}));

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      getConfig: getConfigSpy,
      updateConfig: updateConfigSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  getConfigSpy.mockClear();
  updateConfigSpy.mockClear();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

describe("useProjectDevFlow", () => {
  test("fetches and exposes the server settings, automations, and skipped agents", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-fetch"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getConfigSpy).toHaveBeenCalledWith("project-fetch");
    expect(result.current.settings).toEqual(baseResponse.devFlow!);
    expect(result.current.automations).toHaveLength(1);
    expect(result.current.skippedExistingUserAgents).toEqual([]);
    expect(result.current.hasChanges).toBe(false);
  });

  test("defaults to a disabled empty form when no dev-flow config exists", async () => {
    getConfigSpy.mockImplementationOnce(async () => ({
      devFlow: null,
      automations: [],
      skippedExistingUserAgents: [],
    }));
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-empty"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings).toEqual({
      enabled: false,
      codingAgent: null,
      aiProvider: null,
      model: null,
      reasoningLevel: null,
      maxConcurrentJobs: null,
    });
  });

  test("switching coding agent stages the admitted provider and model defaults together", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-agent"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleCodingAgentChange("opencode"));

    expect(result.current.settings).toMatchObject({
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
    });
    expect(result.current.hasChanges).toBe(true);
  });

  test("switching AI provider picks its admitted default model and clears reasoning", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-provider"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleAiProviderChange("zai"));

    expect(result.current.settings).toMatchObject({
      codingAgent: "claude-code",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
    });
  });

  test("saves only dirty dev-flow scalar paths", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-save"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleMaxConcurrentJobsChange("5"));
    act(() => result.current.handleSave());

    await waitFor(() => expect(updateConfigSpy).toHaveBeenCalledTimes(1));
    expect(updateConfigSpy).toHaveBeenCalledWith("project-save", {
      agentDefaults: { devFlow: { maxConcurrentJobs: 5 } },
    } satisfies ProjectDevFlowPatchBody);
    await waitFor(() => expect(result.current.hasChanges).toBe(false));
  });

  test("omits untouched automation overrides from a card-level merge patch", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-automation-omit"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleToggleEnabled(false));
    act(() => result.current.handleSave());

    await waitFor(() => expect(updateConfigSpy).toHaveBeenCalledTimes(1));
    const [, body] = updateConfigSpy.mock.calls[0]! as [string, ProjectDevFlowPatchBody];
    expect(body).toEqual({ agentDefaults: { devFlow: { enabled: false } } });
    expect(body.agentDefaults?.devFlow).not.toHaveProperty("automations");
  });

  test("discard restores server settings without saving", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("project-discard"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleToggleEnabled(false));
    act(() => result.current.handleDiscard());

    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.hasChanges).toBe(false);
    expect(updateConfigSpy).not.toHaveBeenCalled();
  });
});
