import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ScheduledAgentExplainResult } from "@/domains/scheduled-agents/domain/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

const explainResult: ScheduledAgentExplainResult = {
  configId: "agent-1",
  name: "Backlog drain",
  projectId: "p1",
  projectName: "Project 1",
  verdict: "would-dispatch",
  blockedBy: null,
  gates: [{ gate: "enabled", passed: true, detail: "enabled=true" }],
};

const explainAgentSpy = mock(async (_agentId: string): Promise<ScheduledAgentExplainResult> => explainResult);

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    devFlowApi: {
      ...realApi.devFlowApi,
      explainAgent: explainAgentSpy,
    },
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  explainAgentSpy.mockClear();
});

describe("useDevFlowDiagnostics", () => {
  it("starts with an empty diagnosis map", async () => {
    const { useDevFlowDiagnostics } = await import("./use-dev-flow-diagnostics");
    const { result } = renderHook(() => useDevFlowDiagnostics());

    expect(result.current.diagnosisByConfigId).toEqual({});
  });

  it("transitions loading -> loaded and stores the explain result keyed by configId", async () => {
    const { useDevFlowDiagnostics } = await import("./use-dev-flow-diagnostics");
    const { result } = renderHook(() => useDevFlowDiagnostics());

    act(() => {
      result.current.diagnose("agent-1");
    });

    expect(result.current.diagnosisByConfigId["agent-1"]?.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.diagnosisByConfigId["agent-1"]?.status).toBe("loaded");
    });

    expect(explainAgentSpy).toHaveBeenCalledWith("agent-1");
    expect(result.current.diagnosisByConfigId["agent-1"]?.result?.verdict).toBe("would-dispatch");
    expect(result.current.diagnosisByConfigId["agent-1"]?.error).toBeNull();
  });

  it("transitions loading -> error and stores a readable message when the explain call rejects", async () => {
    explainAgentSpy.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const { useDevFlowDiagnostics } = await import("./use-dev-flow-diagnostics");
    const { result } = renderHook(() => useDevFlowDiagnostics());

    act(() => {
      result.current.diagnose("agent-2");
    });

    await waitFor(() => {
      expect(result.current.diagnosisByConfigId["agent-2"]?.status).toBe("error");
    });

    expect(result.current.diagnosisByConfigId["agent-2"]?.error).toBe("boom");
    expect(result.current.diagnosisByConfigId["agent-2"]?.result).toBeNull();
  });

  it("keeps each configId's diagnosis independent", async () => {
    const { useDevFlowDiagnostics } = await import("./use-dev-flow-diagnostics");
    const { result } = renderHook(() => useDevFlowDiagnostics());

    act(() => {
      result.current.diagnose("agent-1");
    });

    await waitFor(() => {
      expect(result.current.diagnosisByConfigId["agent-1"]?.status).toBe("loaded");
    });

    expect(result.current.diagnosisByConfigId["agent-3"]).toBeUndefined();
  });
});
