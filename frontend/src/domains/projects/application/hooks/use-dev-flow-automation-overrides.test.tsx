import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test, mock } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "../../domain/dev-flow-automation-overrides";
import type {
  ProjectDevFlowAutomationEffective,
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowPatchBody,
  ProjectDevFlowSettings,
} from "../../domain/types";

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

const updateAutomationOverridesSpy = mock(async (_projectId: string, _body: unknown) => ({}));

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      updateAutomationOverrides: updateAutomationOverridesSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  updateAutomationOverridesSpy.mockClear();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const cardSettings: ProjectDevFlowSettings = {
  enabled: true,
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
};

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
  description: "Picks ready work.",
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
  test("starts without drafts and does not wait on unrelated AI config", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-empty", [automation()], cardSettings),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.drafts["backlog-drain"]).toBeUndefined();
  });

  test("stages model edits from the raw server override and normalizes the edited effort", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [automation({
      overrides: {
        ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
        model: "future-model",
        reasoningLevel: "future-effort",
      },
    })];
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-model", automations, cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "model", "claude-haiku-4-5"));

    expect(result.current.drafts["backlog-drain"]!.override).toMatchObject({
      model: "claude-haiku-4-5",
      reasoningLevel: null,
    });
    expect(result.current.drafts["backlog-drain"]!.hasChanges).toBe(true);
  });

  test("switching a mutable automation to Pi stages the exact admitted tuple", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-pi", [automation()], cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "codingAgent", "pi"));

    expect(result.current.drafts["backlog-drain"]!.override).toMatchObject({
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      reasoningLevel: null,
    });
  });

  test("switching AI provider picks the admitted model default and clears reasoning", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-provider", [automation()], cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "aiProvider", "zai"));

    expect(result.current.drafts["backlog-drain"]!.override).toMatchObject({
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
    });
  });

  test("saves only the dirty fields for the selected automation", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-save", [automation()], cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5"));
    act(() => result.current.handleFieldChange("backlog-drain", "reasoningLevel", "low"));
    act(() => result.current.handleSave("backlog-drain"));

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));
    expect(updateAutomationOverridesSpy).toHaveBeenCalledWith("project-save", {
      agentDefaults: {
        devFlow: {
          automations: {
            "backlog-drain": { model: "claude-sonnet-5", reasoningLevel: "low" },
          },
        },
      },
    } satisfies ProjectDevFlowPatchBody);
    await waitFor(() => expect(result.current.drafts["backlog-drain"]).toBeUndefined());
  });

  test("saving one row neither sends nor clears another row's draft", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [
      automation({ automationId: "backlog-drain" }),
      automation({ automationId: "dod-remediation" }),
    ];
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-isolated", automations, cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5"));
    act(() => result.current.handleFieldChange("dod-remediation", "reasoningLevel", "low"));
    act(() => result.current.handleSave("backlog-drain"));

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));
    const [, body] = updateAutomationOverridesSpy.mock.calls[0]! as [string, ProjectDevFlowPatchBody];
    expect(body.agentDefaults?.devFlow?.automations).toEqual({
      "backlog-drain": { model: "claude-sonnet-5" },
    });
    await waitFor(() => expect(result.current.drafts["backlog-drain"]).toBeUndefined());
    expect(result.current.drafts["dod-remediation"]!.override.reasoningLevel).toBe("low");
  });

  test("reset emits explicit null only for fields currently overridden on that row", async () => {
    const serverOverride = {
      ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
      model: "future-model",
      reasoningLevel: "future-effort",
      schedule: { expression: "0 9 * * *", timezone: null },
    };
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides(
        "project-reset",
        [automation({ overrides: serverOverride })],
        cardSettings,
      ),
      { wrapper },
    );

    act(() => result.current.handleResetToDefaults("backlog-drain"));

    await waitFor(() => expect(updateAutomationOverridesSpy).toHaveBeenCalledTimes(1));
    expect(updateAutomationOverridesSpy).toHaveBeenCalledWith("project-reset", {
      agentDefaults: {
        devFlow: {
          automations: {
            "backlog-drain": {
              model: null,
              reasoningLevel: null,
              schedule: null,
            },
          },
        },
      },
    });
  });

  test("marks only the selected row as saving while its merge patch is in flight", async () => {
    let resolveSave: (() => void) | undefined;
    updateAutomationOverridesSpy.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSave = () => resolve({});
      }),
    );
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const automations = [
      automation({ automationId: "backlog-drain" }),
      automation({ automationId: "dod-remediation" }),
    ];
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-pending", automations, cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5"));
    act(() => result.current.handleFieldChange("dod-remediation", "reasoningLevel", "low"));
    act(() => result.current.handleSave("backlog-drain"));

    await waitFor(() => expect(result.current.drafts["backlog-drain"]!.isSaving).toBe(true));
    expect(result.current.drafts["dod-remediation"]!.isSaving).toBe(false);

    act(() => resolveSave?.());
    await waitFor(() => expect(result.current.drafts["backlog-drain"]).toBeUndefined());
  });

  test("discard removes one local draft without calling the API", async () => {
    const { useDevFlowAutomationOverrides } = await import("./use-dev-flow-automation-overrides");
    const { result } = renderHook(
      () => useDevFlowAutomationOverrides("project-discard", [automation()], cardSettings),
      { wrapper },
    );

    act(() => result.current.handleFieldChange("backlog-drain", "model", "claude-sonnet-5"));
    act(() => result.current.handleDiscard("backlog-drain"));

    expect(result.current.drafts["backlog-drain"]).toBeUndefined();
    expect(updateAutomationOverridesSpy).not.toHaveBeenCalled();
  });
});
