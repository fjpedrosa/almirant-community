import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "../../domain/dev-flow-automation-overrides";
import type {
  ProjectAiConfig,
  ProjectDevFlowAutomationEffective,
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowSettings,
} from "../../domain/types";

// Same guard as use-project-dev-flow.test.tsx: prevent the real Better-Auth
// client (created at module load in `@/lib/auth-client`) from running
// against a null base URL under happy-dom, since `use-projects.ts` (which
// this hook imports `projectKeys` from) pulls in `useActiveTeam`.
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

// Fixture for GET /projects/:id/ai-config (review fixes #1+#2, issue #235) —
// use-dev-flow-automation-overrides.ts reads defaultProvider/implementation
// from this SAME query (via useProjectAiConfigQuery) since neither comes
// from the automations array this hook is handed.
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

// The card-level devFlow settings (server-persisted, from useProjectDevFlow's
// `serverSettings`) — passed in by the container so a row save/reset can
// resend them intact (the backend wholesale-replaces the whole devFlow
// object on every PATCH).
const cardSettings: ProjectDevFlowSettings = {
  enabled: true,
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
};

const updateAutomationOverridesSpy = mock(async (_projectId: string, _body: unknown) => ({}));
const getAiConfigSpy = mock(async (_projectId: string): Promise<ProjectAiConfig> => aiConfigFixture);

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      updateAutomationOverrides: updateAutomationOverridesSpy,
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
  updateAutomationOverridesSpy.mockClear();
  getAiConfigSpy.mockClear();
});

// Full expected PATCH body wrapper — every payload assertion in this file
// wraps its automations map with this, matching the real
// devFlowApi.updateAutomationOverrides body shape (Fix 1+2).
const expectedBody = (automations: Record<string, unknown>) => ({
  defaultProvider: aiConfigFixture.defaultProvider,
  agentDefaults: {
    implementation: aiConfigFixture.agentDefaults.implementation,
    devFlow: { ...cardSettings, automations },
  },
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

const effective: ProjectDevFlowAutomationEffective = {
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
  schedule: { expression: "*/5 * * * *", timezone: "UTC" },
};

const automation = (
  overrides: Partial<ProjectDevFlowAutomationStatus> = {},
): ProjectDevFlowAutomationStatus => ({
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
  effective,
  ...overrides,
});

describe("useDevFlowAutomationOverrides", () => {
  it("has no draft entries and reports no changes before any edit", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-1", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.drafts["backlog-drain"]).toBeUndefined();
  });

  it("handleFieldChange stages a draft override starting from the server override, marking hasChanges", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-2", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });

    expect(result.current.drafts["backlog-drain"]!.override.model).toBe("claude-sonnet-5");
    expect(result.current.drafts["backlog-drain"]!.override.reasoningLevel).toBeNull();
    expect(result.current.drafts["backlog-drain"]!.hasChanges).toBe(true);
  });

  it("handleFieldChange preserves previously staged fields on the same row (merges, doesn't replace)", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-3", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleFieldChange("backlog-drain", "reasoningLevel", "low");
    });

    expect(result.current.drafts["backlog-drain"]!.override.model).toBe("claude-sonnet-5");
    expect(result.current.drafts["backlog-drain"]!.override.reasoningLevel).toBe("low");
  });

  it("handleScheduleChange stages a schedule override without touching other staged fields", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-4", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleScheduleChange("backlog-drain", { expression: "0 * * * *", timezone: "Europe/Madrid" });
    });

    expect(result.current.drafts["backlog-drain"]!.override.model).toBe("claude-sonnet-5");
    expect(result.current.drafts["backlog-drain"]!.override.schedule).toEqual({
      expression: "0 * * * *",
      timezone: "Europe/Madrid",
    });
  });

  it("handleDiscard clears the local draft without calling the API", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-5", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    expect(result.current.drafts["backlog-drain"]).toBeDefined();

    act(() => {
      result.current.handleDiscard("backlog-drain");
    });

    expect(result.current.drafts["backlog-drain"]).toBeUndefined();
    expect(updateAutomationOverridesSpy).not.toHaveBeenCalled();
  });

  it("handleSave sends the FULL PATCH body — defaultProvider + implementation + card devFlow scalars + the full staged override (not a diff) keyed by automationId — and clears the draft on success", async () => {
    // Review fixes #1+#2 (issue #235): the pre-fix hook sent ONLY the
    // automations map (`updateAutomationOverridesSpy(projectId, payload)`),
    // which client.ts wrapped as `{ agentDefaults: { devFlow: { automations } } }`
    // — missing BOTH `defaultProvider` and `devFlow.enabled`, so the backend's
    // schema (which requires both) rejected every request with a 400.
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-6", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleFieldChange("backlog-drain", "reasoningLevel", "low");
    });
    act(() => {
      result.current.handleSave("backlog-drain");
    });

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));

    const [projectId, body] = updateAutomationOverridesSpy.mock.calls[0]! as [string, ReturnType<typeof expectedBody>];
    expect(projectId).toBe("proj-6");
    expect(body).toEqual(
      expectedBody({
        "backlog-drain": { model: "claude-sonnet-5", reasoningLevel: "low", schedule: null },
      }),
    );

    await waitFor(() => expect(result.current.drafts["backlog-drain"]).toBeUndefined());
  });

  it("REGRESSION (wholesale-replace): saving one row's draft PRESERVES another row's already-persisted server override in the payload", async () => {
    // The backend replaces the whole `devFlow.automations` map with whatever
    // we send — so saving "backlog-drain" must still include "dod-review"'s
    // existing server override, or that override would be silently deleted.
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [
      automation({ automationId: "backlog-drain" }),
      automation({
        automationId: "dod-review",
        overrides: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, reasoningLevel: "low" },
      }),
    ];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-9", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleSave("backlog-drain");
    });

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));

    const [, body] = updateAutomationOverridesSpy.mock.calls[0]! as [string, ReturnType<typeof expectedBody>];
    expect(body).toEqual(
      expectedBody({
        "backlog-drain": { model: "claude-sonnet-5", schedule: null },
        "dod-review": { reasoningLevel: "low", schedule: null },
      }),
    );
  });

  it("handleResetToDefaults sends the FULL PATCH body with the ausente/schedule:null reset payload directly, without requiring a prior edit", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [
      automation({ overrides: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, model: "claude-sonnet-5" } }),
    ];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-7", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleResetToDefaults("backlog-drain");
    });

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));

    const [, body] = updateAutomationOverridesSpy.mock.calls[0]! as [string, ReturnType<typeof expectedBody>];
    expect(body).toEqual(expectedBody({}));
  });

  it("REGRESSION (wholesale-replace): resetting one row omits ONLY that automationId, preserving every other row's override", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [
      automation({
        automationId: "backlog-drain",
        overrides: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, model: "claude-sonnet-5" },
      }),
      automation({
        automationId: "dod-review",
        overrides: {
          ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
          schedule: { expression: "0 9 * * *", timezone: "UTC" },
        },
      }),
    ];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-10", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleResetToDefaults("backlog-drain");
    });

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));

    const [, body] = updateAutomationOverridesSpy.mock.calls[0]! as [string, ReturnType<typeof expectedBody>];
    expect(body.agentDefaults.devFlow.automations).not.toHaveProperty("backlog-drain");
    expect(body).toEqual(
      expectedBody({
        "dod-review": { schedule: { expression: "0 9 * * *", timezone: "UTC" } },
      }),
    );
  });

  it("isSaving is true for every row that currently has a staged draft while the shared mutation is in flight (all drafts ride along in the wholesale payload)", async () => {
    let resolveSave: (() => void) | null = null;
    updateAutomationOverridesSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({});
        }),
    );

    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation({ automationId: "backlog-drain" }), automation({ automationId: "dod-review" })];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-8", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleFieldChange("dod-review", "reasoningLevel", "low");
    });
    act(() => {
      result.current.handleSave("backlog-drain");
    });

    await waitFor(() => expect(result.current.drafts["backlog-drain"]!.isSaving).toBe(true));
    // dod-review also has an unsaved draft, and that draft rides along in the
    // same wholesale payload — so it's part of the same in-flight save too.
    expect(result.current.drafts["dod-review"]!.isSaving).toBe(true);

    resolveSave!();

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));
    // Both drafts were included in what was just persisted, so both are
    // cleared on success — not just the row whose Save button was clicked.
    await waitFor(() => expect(result.current.drafts["backlog-drain"]).toBeUndefined());
    expect(result.current.drafts["dod-review"]).toBeUndefined();
  });

  it("isSaving stays false for a row with no draft at all while another row is being saved", async () => {
    let resolveSave: (() => void) | null = null;
    updateAutomationOverridesSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({});
        }),
    );

    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation({ automationId: "backlog-drain" }), automation({ automationId: "dod-review" })];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-11", automations, cardSettings), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5");
    });
    act(() => {
      result.current.handleSave("backlog-drain");
    });

    await waitFor(() => expect(result.current.drafts["backlog-drain"]!.isSaving).toBe(true));
    expect(result.current.drafts["dod-review"]).toBeUndefined();

    resolveSave!();
    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));
  });

  it("exposes isLoading:true while the ai-config query (defaultProvider/implementation for the save body) hasn't resolved yet", async () => {
    let resolveAiConfig: ((value: ProjectAiConfig) => void) | null = null;
    getAiConfigSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAiConfig = resolve;
        }),
    );

    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation()];

    const { result } = renderHook(() => useDevFlowAutomationOverrides("proj-12", automations, cardSettings), { wrapper });

    expect(result.current.isLoading).toBe(true);

    resolveAiConfig!(aiConfigFixture);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
