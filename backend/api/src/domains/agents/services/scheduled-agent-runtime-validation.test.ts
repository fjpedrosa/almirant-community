import { describe, expect, it } from "bun:test";
import { ScheduledRuntimeAdmissionError } from "@almirant/shared";
import {
  asScheduledAgentRuntimeValidationError,
  assertRuntimeCapabilityIntentAdmission,
  assertValidScheduledAgentRuntime,
  buildRuntimeControls,
  canonicalizeAiModelForStorage,
  isPiCodingAgentAdmissionEnabled,
  normalizePersistedScheduledAgentRuntime,
  PI_ADMISSION_DISABLED,
  ScheduledAgentRuntimeValidationError,
  type RuntimeValidationErrorCode,
} from "./scheduled-agent-runtime-validation";

const expectValidationCode = (
  action: () => unknown,
  code: RuntimeValidationErrorCode,
): void => {
  try {
    action();
    throw new Error("expected scheduled runtime validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduledAgentRuntimeValidationError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toStartWith("Invalid scheduled agent runtime:");
  }
};

const withPiAdmissionEnvironment = <T>(
  value: "true" | "false" | undefined,
  action: () => T,
): T => {
  const previous = process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  if (value === undefined) {
    delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  } else {
    process.env.PI_CODING_AGENT_ADMISSION_ENABLED = value;
  }
  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
    } else {
      process.env.PI_CODING_AGENT_ADMISSION_ENABLED = previous;
    }
  }
};

const piRuntime = {
  provider: "zipu",
  codingAgent: "pi",
  aiProvider: "zai",
  aiModel: "glm-5.3",
  authClass: "api_key",
  capabilities: [],
} as const;

const piCapabilityRuntime = {
  provider: piRuntime.provider,
  codingAgent: piRuntime.codingAgent,
  aiProvider: piRuntime.aiProvider,
  model: piRuntime.aiModel,
  config: {},
} as const;

describe("Pi admission runtime controls", () => {
  it.each([
    ["default", undefined, true, "PI_ADMISSION_ENABLED"],
    ["enabled", "true", true, "PI_ADMISSION_ENABLED"],
    ["disabled", "false", false, "PI_ADMISSION_DISABLED"],
  ] as const)(
    "builds deeply immutable %s runtime controls",
    (_label, value, enabled, code) =>
      withPiAdmissionEnvironment(value, () => {
        const runtimeControls = buildRuntimeControls();

        expect(runtimeControls).toEqual({
          piCodingAgentAdmission: { enabled, code },
        });
        expect(Object.isFrozen(runtimeControls)).toBe(true);
        expect(Object.isFrozen(runtimeControls.piCodingAgentAdmission)).toBe(true);
      }),
  );

  it("rejects malformed direct overrides instead of treating them as defaults", () => {
    expect(() => isPiCodingAgentAdmissionEnabled("invalid")).toThrow(
      "PI_CODING_AGENT_ADMISSION_ENABLED must be 'true' or 'false'",
    );
  });
});

describe("assertValidScheduledAgentRuntime", () => {
  it("admits the exact Pi runtime when the switch is unset or explicitly true", () => {
    for (const value of [undefined, "true"] as const) {
      withPiAdmissionEnvironment(value, () => {
        expect(() => assertValidScheduledAgentRuntime(piRuntime)).not.toThrow();
        expect(() => assertRuntimeCapabilityIntentAdmission(piCapabilityRuntime)).not.toThrow();
      });
    }
  });

  it("rejects Pi centrally with stable policy and nonretryable semantics when false", () => {
    const [resolvedPiRuntime] = withPiAdmissionEnvironment("true", () =>
      assertValidScheduledAgentRuntime(piRuntime)
    );

    withPiAdmissionEnvironment("false", () => {
      for (const action of [
        () => assertValidScheduledAgentRuntime(piRuntime),
        () => assertValidScheduledAgentRuntime({ effectiveRuntimes: [resolvedPiRuntime!] }),
        () => assertRuntimeCapabilityIntentAdmission(piCapabilityRuntime),
      ]) {
        try {
          action();
          throw new Error("expected Pi admission to be disabled");
        } catch (error) {
          expect(error).toBeInstanceOf(ScheduledAgentRuntimeValidationError);
          expect(error).toMatchObject({
            code: PI_ADMISSION_DISABLED,
            category: "policy",
            retryable: false,
          });
          expect((error as Error).message).toBe(
            "Invalid scheduled agent runtime: Pi coding-agent admission is disabled by operator policy.",
          );
        }
      }
    });
  });

  it("does not affect existing runtime families whether the switch is true or false", () => {
    const existingRuntime = {
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.6-sol",
    } as const;

    for (const value of ["true", "false"] as const) {
      withPiAdmissionEnvironment(value, () => {
        expect(() => assertValidScheduledAgentRuntime(existingRuntime)).not.toThrow();
        expect(() => assertRuntimeCapabilityIntentAdmission({
          provider: existingRuntime.provider,
          codingAgent: existingRuntime.codingAgent,
          aiProvider: existingRuntime.aiProvider,
          model: existingRuntime.aiModel,
          config: {},
        })).not.toThrow();
      });
    }
  });

  it("preserves Community Plan Review fanout metadata on existing read-only runtimes", () => {
    const planReviewConfig = {
      workspaceIntent: "read-only",
      sessionMode: "review",
      planReview: {
        intent: "plan-review",
        critics: [{ provider: "zai" }, { provider: "openai" }],
      },
    };

    for (const runtime of [
      {
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.2",
      },
      {
        provider: "codex",
        codingAgent: "opencode",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
      },
    ] as const) {
      expect(() => assertRuntimeCapabilityIntentAdmission({
        ...runtime,
        config: planReviewConfig,
      })).not.toThrow();
    }
  });

  it("keeps Community's incomplete per-automation fanout values on legacy defaults", () => {
    const [defaultRuntime] = assertValidScheduledAgentRuntime({});
    expect(defaultRuntime).toMatchObject({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });

    for (const runtime of [
      {},
      { codingAgent: "opencode", aiProvider: "zai", aiModel: "glm-5.2" },
      { codingAgent: "codex", aiProvider: "openai", aiModel: "gpt-5.6-sol" },
      { codingAgent: "claude-code", aiProvider: "anthropic", aiModel: "claude-opus-4-8" },
    ] as const) {
      expect(() => assertValidScheduledAgentRuntime(runtime)).not.toThrow();
    }
  });

  it("accepts existing Claude, Codex, and OpenCode runtime families", () => {
    const valid = [
      {
        provider: "claude-code",
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        aiModel: "claude-opus-4-8",
      },
      {
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
      },
      {
        provider: "codex",
        codingAgent: "opencode",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
      },
      {
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      },
      {
        provider: "grok",
        codingAgent: "opencode",
        aiProvider: "xai",
        aiModel: "grok-4.3",
      },
      {
        provider: "zipu",
        codingAgent: "claude-code",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      },
    ] as const;

    for (const runtime of valid) {
      expect(() => assertValidScheduledAgentRuntime(runtime)).not.toThrow();
    }
  });

  it("does not invalidate a complete modern tuple for provider mismatch alone", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.6-sol",
    })).not.toThrow();
  });

  it("keeps explicit model ids exact instead of lowercasing them", () => {
    expectValidationCode(
      () => assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "GLM-5.2",
      }),
      "RUNTIME_MODEL_UNSUPPORTED",
    );
  });

  it("rejects unknown explicit coding agents with the typed registry code", () => {
    expectValidationCode(
      () => assertValidScheduledAgentRuntime({
        provider: "runner-lane",
        codingAgent: "future-agent",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
      }),
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
    );
  });

  it("rejects a complete fieldwise-incompatible tuple without repairing it", () => {
    expectValidationCode(
      () => assertValidScheduledAgentRuntime({
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      }),
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
    );
  });

  it("admits only Pi / Z.AI / GLM-5.3 with API-key auth and no optional capabilities", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "existing-routing-lane",
      codingAgent: "pi",
      aiProvider: "zai",
      aiModel: "glm-5.3",
      authClass: "api_key",
      capabilities: [],
    })).not.toThrow();

    const disabledPiRows = [
      ["anthropic", "claude-opus-5"],
      ["openai", "gpt-5.6-sol"],
      ["google", "gemini-3.1-pro-preview"],
      ["zai", "glm-5.2"],
      ["xai", "grok-4.3"],
    ] as const;

    for (const [aiProvider, aiModel] of disabledPiRows) {
      expectValidationCode(
        () => assertValidScheduledAgentRuntime({
          provider: "existing-routing-lane",
          codingAgent: "pi",
          aiProvider,
          aiModel,
          authClass: "api_key",
          capabilities: [],
        }),
        "RUNTIME_ADMISSION_DISABLED",
      );
    }
  });

  it("passes through exact WU-1 Pi capability rejection codes", () => {
    const capabilities = [
      ["mcp", "PI_CAPABILITY_MCP_DISABLED"],
      ["browser", "PI_CAPABILITY_BROWSER_DISABLED"],
      ["read_only_enforced", "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED"],
    ] as const;

    for (const [capability, code] of capabilities) {
      expectValidationCode(
        () => assertValidScheduledAgentRuntime({
          provider: "existing-routing-lane",
          codingAgent: "pi",
          aiProvider: "zai",
          aiModel: "glm-5.3",
          authClass: "api_key",
          capabilities: [capability],
        }),
        code,
      );
    }
  });

  it("derives exact Pi auth and capability intent from the final enqueue config", () => {
    const base = {
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    } as const;

    expect(() => assertRuntimeCapabilityIntentAdmission({
      ...base,
      config: {},
    })).not.toThrow();

    const cases = [
      [{ mcpServerUrl: "https://mcp.example.com" }, "PI_CAPABILITY_MCP_DISABLED"],
      [{ mcpServers: { docs: { url: "https://mcp.example.com" } } }, "PI_CAPABILITY_MCP_DISABLED"],
      [{ selectedMcpServerIds: ["6e9fa58b-3490-4e39-982f-444e5c697e55"] }, "PI_CAPABILITY_MCP_DISABLED"],
      [{ needsBrowser: true }, "PI_CAPABILITY_BROWSER_DISABLED"],
      [{ workspaceIntent: "read-only" }, "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED"],
      [{ permissionMode: "ask" }, "PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED"],
      [{ authClass: "subscription" }, "PI_AUTH_SUBSCRIPTION_DISABLED"],
    ] as const;

    for (const [config, code] of cases) {
      expectValidationCode(
        () => assertRuntimeCapabilityIntentAdmission({ ...base, config }),
        code,
      );
    }
  });

  it("validates reasoning against the admitted model tuple", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.5-pro",
      reasoningLevel: "high",
    })).not.toThrow();

    for (const [aiModel, reasoningLevel] of [
      ["gpt-4.1", "high"],
      ["gpt-5.5-pro", "low"],
      ["gpt-5.6-sol", "none"],
      ["gpt-5.6-sol", "minimal"],
    ] as const) {
      expect(() => assertValidScheduledAgentRuntime({
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel,
        reasoningLevel,
      })).toThrow(new RegExp(`reasoningLevel '${reasoningLevel}' is not supported`));
    }

    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "glm-5.2",
      reasoningLevel: "max",
    })).not.toThrow();
    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "glm-5.1",
      reasoningLevel: "high",
    })).toThrow(/reasoningLevel 'high' is not supported/);
  });

  it("validates every inherited connection model and fails closed on an empty list", () => {
    expectValidationCode(
      () => assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        effectiveAiModels: ["glm-5.2", "glm-5v-turbo"],
      }),
      "RUNTIME_MODEL_UNSUPPORTED",
    );

    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      effectiveAiModels: [],
    })).toThrow(/could not resolve an effective model/i);
  });

  it("keeps the typed Z.AI model rejection and its stable Coding Plan message", () => {
    try {
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "glm-5v-turbo",
      });
      throw new Error("expected the non-entitled Z.AI model to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduledAgentRuntimeValidationError);
      expect(error).toMatchObject({ code: "RUNTIME_MODEL_UNSUPPORTED" });
      expect((error as Error).message).toBe(
        "Invalid scheduled agent runtime: agent: model 'glm-5v-turbo' is not available through the Z.AI Coding Plan.",
      );
    }

    const upstreamRegistryError = new ScheduledRuntimeAdmissionError(
      "RUNTIME_MODEL_UNSUPPORTED",
      {
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5v-turbo",
        authClass: "api_key",
        capabilities: [],
      },
    );
    const normalized = asScheduledAgentRuntimeValidationError(upstreamRegistryError);
    expect(normalized).toBeInstanceOf(ScheduledAgentRuntimeValidationError);
    expect(normalized).toMatchObject({ code: "RUNTIME_MODEL_UNSUPPORTED" });
    expect(normalized?.message).toBe(
      "Invalid scheduled agent runtime: agent effective runtime: model 'glm-5v-turbo' is not available through the Z.AI Coding Plan.",
    );
  });

  it("validates backlog project rules through the same fieldwise resolver", () => {
    expectValidationCode(
      () => assertValidScheduledAgentRuntime({
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
        targetConfig: {
          backlogDrain: {
            enabled: true,
            projects: [{
              projectId: "project-1",
              aiProvider: "zai",
              model: "glm-5.2",
            }],
          },
        },
      }),
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
    );
  });
});

describe("canonicalizeAiModelForStorage", () => {
  it("preserves every non-empty explicit model id exactly", () => {
    expect(canonicalizeAiModelForStorage("GLM-5.2")).toBe("GLM-5.2");
    expect(canonicalizeAiModelForStorage("  glm-5.2  ")).toBe("  glm-5.2  ");
    expect(canonicalizeAiModelForStorage("glm-5.2")).toBe("glm-5.2");
  });

  it("returns null only for genuinely empty values", () => {
    expect(canonicalizeAiModelForStorage("")).toBeNull();
    expect(canonicalizeAiModelForStorage("   ")).toBeNull();
    expect(canonicalizeAiModelForStorage(null)).toBeNull();
    expect(canonicalizeAiModelForStorage(undefined)).toBeNull();
  });
});

describe("normalizePersistedScheduledAgentRuntime", () => {
  it("omits a legacy Haiku reasoning level while retaining the selected runtime", () => {
    expect(normalizePersistedScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
      reasoningLevel: "low",
    })).toEqual({
      runtime: {
        provider: "claude-code",
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        aiModel: "claude-haiku-4-5",
        reasoningLevel: undefined,
      },
      omittedReasoningLevels: [{
        model: "claude-haiku-4-5",
        aiProvider: "anthropic",
        reasoningLevel: "low",
      }],
    });
  });

  it("keeps supported and stale non-Haiku reasoning values for strict validation", () => {
    expect(normalizePersistedScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-sonnet-5",
      reasoningLevel: "low",
    }).runtime.reasoningLevel).toBe("low");

    expect(normalizePersistedScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "glm-5.1",
      reasoningLevel: "max",
    }).runtime.reasoningLevel).toBe("max");
  });
});
