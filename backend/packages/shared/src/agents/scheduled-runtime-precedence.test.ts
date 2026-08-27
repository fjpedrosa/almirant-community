import { describe, expect, it } from "bun:test";
import {
  resolveScheduledRuntimePrecedence,
  ScheduledRuntimeAdmissionError,
  type ScheduledRuntimeSource,
} from "./scheduled-runtime-precedence";

const expectAdmissionCode = (
  action: () => unknown,
  code: ScheduledRuntimeAdmissionError["code"],
): void => {
  try {
    action();
    throw new Error("expected scheduled runtime admission to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduledRuntimeAdmissionError);
    expect(error).toMatchObject({ code });
  }
};

describe("resolveScheduledRuntimePrecedence", () => {
  it("records the source of every field before admitting the complete tuple", () => {
    const runtime = resolveScheduledRuntimePrecedence({
      rule: { provider: "rule-runner-lane" },
      schedule: { codingAgent: "opencode" },
      workItem: { aiProvider: "openai" },
      project: { model: "gpt-5.6-sol" },
      connection: { reasoningLevel: "high" },
    });

    expect(runtime).toMatchObject({
      provider: "rule-runner-lane",
      codingAgent: "opencode",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
      authClass: "api_key",
      capabilities: [],
      provenance: {
        provider: { source: "rule", resolution: "source-value" },
        codingAgent: { source: "schedule", resolution: "source-value" },
        aiProvider: { source: "workItem", resolution: "source-value" },
        model: { source: "project", resolution: "source-value" },
        reasoningLevel: { source: "connection", resolution: "source-value" },
        authClass: { source: "legacy-default", resolution: "legacy-adapter" },
        capabilities: { source: "legacy-default", resolution: "legacy-adapter" },
      },
    });
  });

  it("uses rule, schedule, work-item, project, connection, then legacy defaults for each field", () => {
    const sources = ["rule", "schedule", "workItem", "project", "connection"] as const;

    for (const source of sources) {
      const input: Partial<Record<(typeof sources)[number], ScheduledRuntimeSource>> = {
        schedule: {
          provider: "codex",
          codingAgent: "codex",
          aiProvider: "openai",
          reasoningLevel: "high",
        },
      };
      input[source] = { ...input[source], model: "gpt-5.6-sol" };

      const runtime = resolveScheduledRuntimePrecedence(input);
      expect(runtime.model).toBe("gpt-5.6-sol");
      expect(runtime.provenance.model.source).toBe(source);
    }

    const defaulted = resolveScheduledRuntimePrecedence({
      schedule: { provider: "codex", codingAgent: "codex", aiProvider: "openai" },
    });
    expect(defaulted.model).toBe("gpt-5.6-sol");
    expect(defaulted.provenance.model).toEqual({
      source: "legacy-default",
      resolution: "legacy-adapter",
    });
  });

  it("preserves Community's Z.AI schedule default and valid field precedence", () => {
    const runtime = resolveScheduledRuntimePrecedence({
      rule: { model: "glm-5.2" },
      schedule: {
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        reasoningLevel: "high",
      },
      connection: { model: "glm-5.1", reasoningLevel: "max" },
    });
    expect(runtime).toMatchObject({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: "high",
    });

    expect(resolveScheduledRuntimePrecedence({
      schedule: { provider: "zipu", codingAgent: "opencode", aiProvider: "zai" },
    }).model).toBe("glm-5.2");
  });

  it("keeps connection-stage model and reasoning on the same connection candidate", () => {
    expect(resolveScheduledRuntimePrecedence({
      schedule: { provider: "zipu", codingAgent: "opencode", aiProvider: "zai" },
      connection: { model: "glm-5.2", reasoningLevel: "max" },
    })).toMatchObject({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: "max",
      provenance: {
        model: { source: "connection", resolution: "source-value" },
        reasoningLevel: { source: "connection", resolution: "source-value" },
      },
    });
  });

  it("uses the named legacy adapter for codex-cli without changing its source", () => {
    const runtime = resolveScheduledRuntimePrecedence({
      schedule: {
        provider: "codex",
        codingAgent: "codex-cli",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
      },
    });

    expect(runtime.codingAgent).toBe("codex");
    expect(runtime.provenance.codingAgent).toEqual({
      source: "schedule",
      resolution: "legacy-adapter",
    });
  });

  it("does not rewrite an explicit modern model id to make it admissible", () => {
    expectAdmissionCode(
      () => resolveScheduledRuntimePrecedence({
        schedule: {
          provider: "zipu",
          codingAgent: "opencode",
          aiProvider: "zai",
          model: "GLM-5.2",
        },
      }),
      "RUNTIME_MODEL_UNSUPPORTED",
    );
  });

  it("rejects an incompatible tuple assembled fieldwise instead of repairing it", () => {
    expectAdmissionCode(
      () => resolveScheduledRuntimePrecedence({
        schedule: { provider: "codex", codingAgent: "codex" },
        project: { aiProvider: "zai" },
        connection: { model: "glm-5.2" },
      }),
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
    );
  });

  it("rejects an unknown non-empty coding agent through the registry", () => {
    expectAdmissionCode(
      () => resolveScheduledRuntimePrecedence({
        schedule: {
          provider: "runner-lane",
          codingAgent: "future-agent",
          aiProvider: "openai",
          model: "gpt-5.6-sol",
        },
      }),
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
    );
  });

  it("treats infrastructure provider as routing evidence, not tuple admission", () => {
    expect(resolveScheduledRuntimePrecedence({
      schedule: {
        provider: "claude-code",
        codingAgent: "codex",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
      },
    })).toMatchObject({
      provider: "claude-code",
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
    });
  });
});
