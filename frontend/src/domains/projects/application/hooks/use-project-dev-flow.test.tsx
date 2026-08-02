import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ProjectAiConfig,
  ProjectDevFlowConfigResponse,
  ProjectDevFlowPatchBody,
} from "../../domain/types";

// Prevent the real Better-Auth client (created at module load in
// `@/lib/auth-client`) from running against a null base URL under happy-dom.
// `use-projects.ts` (which this hook imports `projectKeys` from) pulls in
// `useActiveTeam`, which imports the real auth client at module scope.
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
    reasoningLevel: null,
    maxConcurrentJobs: 2,
  },
  automations: [
    {
      automationId: "backlog-drain",
      targetConfigKey: "backlogDrain",
      name: "Backlog drain",
      description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
      configId: "agent-1",
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
  ],
  skippedExistingUserAgents: [],
};

// Fixture for GET /projects/:id/ai-config (review fixes #1+#2, issue #235) —
// use-project-dev-flow.ts now reads defaultProvider/implementation from this
// SAME query (via useProjectAiConfigQuery) since GET /dev-flow doesn't carry
// them, but a devFlow save's PATCH body must still include them intact.
const aiConfigFixture: ProjectAiConfig = {
  defaultProvider: "codex",
  agentDefaults: {
    implementation: {
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
      reasoningLevel: null,
    },
  },
};

const getConfigSpy = mock(async (_projectId: string): Promise<ProjectDevFlowConfigResponse> => baseResponse);
const updateConfigSpy = mock(async (_projectId: string, _body: unknown) => ({}));
const getAiConfigSpy = mock(async (_projectId: string): Promise<ProjectAiConfig> => aiConfigFixture);

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      getConfig: getConfigSpy,
      updateConfig: updateConfigSpy,
    },
    projectsApi: {
      ...realApi.projectsApi,
      getAiConfig: getAiConfigSpy,
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
  getAiConfigSpy.mockClear();
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

describe("useProjectDevFlow", () => {
  it("fetches the dev-flow config and exposes settings/agents/skipped agents", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");

    const { result } = renderHook(() => useProjectDevFlow("proj-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getConfigSpy).toHaveBeenCalledWith("proj-1");
    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.settings.maxConcurrentJobs).toBe(2);
    expect(result.current.automations).toHaveLength(1);
    expect(result.current.skippedExistingUserAgents).toEqual([]);
    expect(result.current.hasChanges).toBe(false);
  });

  it("defaults to a disabled/empty form when the project has no dev-flow config yet", async () => {
    getConfigSpy.mockImplementationOnce(async () => ({
      devFlow: null,
      automations: [],
      skippedExistingUserAgents: [],
    }));

    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("proj-2"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.enabled).toBe(false);
    expect(result.current.settings.codingAgent).toBeNull();
    expect(result.current.settings.maxConcurrentJobs).toBeNull();
  });

  it("marks hasChanges true after toggling enabled locally, and reflects the new value", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("proj-3"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleToggleEnabled(false);
    });

    expect(result.current.hasChanges).toBe(true);
    expect(result.current.settings.enabled).toBe(false);
  });

  it("handleDiscard resets local edits back to the server state", async () => {
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("proj-4"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleToggleEnabled(false);
    });
    expect(result.current.hasChanges).toBe(true);

    act(() => {
      result.current.handleDiscard();
    });

    expect(result.current.hasChanges).toBe(false);
    expect(result.current.settings.enabled).toBe(true);
  });

  it("handleSave sends the FULL PATCH body — defaultProvider + implementation + devFlow scalars + automations map — via devFlowApi.updateConfig, and refetches on success", async () => {
    // Review fixes #1+#2 (issue #235): the pre-fix hook sent ONLY the
    // settings object (`updateConfigSpy(projectId, settings)`), which
    // client.ts wrapped as `{ agentDefaults: { devFlow: settings } }` — no
    // `defaultProvider` key at all, so the backend's schema (which requires
    // it, Nullable but NOT Optional) rejected the request with a 400 every
    // single time. This test proves the fixed hook builds the complete body
    // the backend actually requires.
    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("proj-5"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleMaxConcurrentJobsChange("5");
    });

    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => expect(updateConfigSpy).toHaveBeenCalledTimes(1));

    const [projectId, body] = updateConfigSpy.mock.calls[0]! as [string, ProjectDevFlowPatchBody];
    expect(projectId).toBe("proj-5");
    // Old bug #1: defaultProvider was never sent -> 400 always.
    expect(body.defaultProvider).toBe("codex");
    // Old bug #2: implementation would be silently wiped by the wholesale
    // JSONB replace if the card-level save didn't resend it intact.
    expect(body.agentDefaults.implementation).toEqual({
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
      reasoningLevel: null,
    });
    expect(body.agentDefaults.devFlow.enabled).toBe(true);
    expect(body.agentDefaults.devFlow.maxConcurrentJobs).toBe(5);
    // No automation currently has a server override in this fixture, so the
    // map is empty — but the KEY itself must still be present (see the next
    // test for the non-empty case), never omitted.
    expect(body.agentDefaults.devFlow.automations).toEqual({});

    await waitFor(() => expect(result.current.hasChanges).toBe(false));
  });

  it("preserves an already-persisted automation override in the payload when saving only the card-level switch (wholesale-replace safety)", async () => {
    getConfigSpy.mockImplementationOnce(async () => ({
      ...baseResponse,
      automations: [
        {
          ...baseResponse.automations[0]!,
          overrides: {
            enabled: null,
            codingAgent: null,
            aiProvider: null,
            model: "claude-sonnet-5",
            reasoningLevel: null,
            maxConcurrentJobs: null,
            schedule: null,
          },
        },
      ],
    }));

    const { useProjectDevFlow } = await import("./use-project-dev-flow");
    const { result } = renderHook(() => useProjectDevFlow("proj-6"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleToggleEnabled(false);
    });
    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => expect(updateConfigSpy).toHaveBeenCalledTimes(1));

    const [, body] = updateConfigSpy.mock.calls[0]! as [string, ProjectDevFlowPatchBody];
    expect(body.agentDefaults.devFlow.automations).toEqual({
      "backlog-drain": { model: "claude-sonnet-5", schedule: null },
    });
  });
});
