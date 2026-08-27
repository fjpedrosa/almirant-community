import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test, mock } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectAiConfig, ProjectDevFlowPatchBody } from "../../domain/types";

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

const persistedConfig: ProjectAiConfig = {
  defaultProvider: "claude-code",
  agentDefaults: {
    implementation: {
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-5",
      reasoningLevel: "high",
    },
  },
};

const getAiConfigSpy = mock<
  (projectId: string) => Promise<ProjectAiConfig>
>(async () => persistedConfig);
const updateAiConfigSpy = mock<
  (projectId: string, patch: ProjectDevFlowPatchBody) => Promise<ProjectAiConfig>
>(async () => persistedConfig);

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    projectsApi: {
      ...realApi.projectsApi,
      getAiConfig: getAiConfigSpy,
      updateAiConfig: updateAiConfigSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  getAiConfigSpy.mockClear();
  updateAiConfigSpy.mockClear();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

describe("useProjectAiConfig", () => {
  test("returns the persisted implementation tuple verbatim", async () => {
    getAiConfigSpy.mockImplementationOnce(async () => ({
      defaultProvider: "future-runner",
      agentDefaults: {
        implementation: {
          codingAgent: "future-agent",
          aiProvider: "future-provider",
          model: "future-model",
          reasoningLevel: "future-effort",
        },
      },
    }));
    const { useProjectAiConfig } = await import("./use-project-ai-config");

    const { result } = renderHook(() => useProjectAiConfig("project-raw"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.defaultProvider).toBe("future-runner");
    expect(result.current.implementationDefaults).toEqual({
      codingAgent: "future-agent",
      aiProvider: "future-provider",
      model: "future-model",
      reasoningLevel: "future-effort",
    });
    expect(result.current.hasChanges).toBe(false);
  });

  test("derives implementation defaults from the legacy provider only when no implementation key was persisted", async () => {
    getAiConfigSpy.mockImplementationOnce(async () => ({
      defaultProvider: "codex",
      agentDefaults: {},
    }));
    const { useProjectAiConfig } = await import("./use-project-ai-config");

    const { result } = renderHook(() => useProjectAiConfig("project-derived"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.implementationDefaults).toEqual({
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
      reasoningLevel: null,
    });
  });

  test("changing only the legacy runner does not rewrite a retained implementation tuple", async () => {
    getAiConfigSpy.mockImplementationOnce(async () => ({
      defaultProvider: "future-runner",
      agentDefaults: {
        implementation: {
          codingAgent: "future-agent",
          aiProvider: "future-provider",
          model: "future-model",
          reasoningLevel: "future-effort",
        },
      },
    }));
    const { useProjectAiConfig } = await import("./use-project-ai-config");
    const { result } = renderHook(() => useProjectAiConfig("project-provider"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleChange("codex"));
    expect(result.current.implementationDefaults.codingAgent).toBe("future-agent");
    expect(result.current.hasChanges).toBe(true);

    act(() => result.current.handleSave());
    await waitFor(() => expect(updateAiConfigSpy).toHaveBeenCalledTimes(1));
    expect(updateAiConfigSpy).toHaveBeenCalledWith("project-provider", {
      defaultProvider: "codex",
    });
  });

  test("switching the implementation coding agent to Pi stages its exact admitted tuple", async () => {
    const { useProjectAiConfig } = await import("./use-project-ai-config");
    const { result } = renderHook(() => useProjectAiConfig("project-pi"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleCodingAgentChange("pi"));
    expect(result.current.implementationDefaults).toEqual({
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      reasoningLevel: null,
    });

    act(() => result.current.handleSave());
    await waitFor(() => expect(updateAiConfigSpy).toHaveBeenCalledTimes(1));
    expect(updateAiConfigSpy).toHaveBeenCalledWith("project-pi", {
      agentDefaults: {
        implementation: {
          codingAgent: "pi",
          aiProvider: "zai",
          model: "glm-5.3",
          reasoningLevel: null,
        },
      },
    });
  });

  test("changing AI provider picks the admitted provider default and clears reasoning", async () => {
    const { useProjectAiConfig } = await import("./use-project-ai-config");
    const { result } = renderHook(() => useProjectAiConfig("project-ai-provider"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleAiProviderChange("zai"));

    expect(result.current.implementationDefaults).toEqual({
      codingAgent: "claude-code",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
    });
  });

  test("discard restores the server tuple without a mutation", async () => {
    const { useProjectAiConfig } = await import("./use-project-ai-config");
    const { result } = renderHook(() => useProjectAiConfig("project-discard"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.handleCodingAgentChange("pi"));
    act(() => result.current.handleDiscard());

    expect(result.current.implementationDefaults).toEqual({
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-5",
      reasoningLevel: "high",
    });
    expect(result.current.hasChanges).toBe(false);
    expect(updateAiConfigSpy).not.toHaveBeenCalled();
  });
});
