import { describe, expect, it } from "bun:test";
import { runtimeCapabilityRegistry } from "./runtime-capability-registry";
import {
  LegacyRuntimeSelectionError,
} from "./legacy-runtime-selection-adapter";
import {
  resolveRequestedRuntimeSelection,
  resolveRuntime,
  type RequestedRuntimeSelection,
} from "./runtime-selection";

const modernRequest = (
  overrides: Partial<RequestedRuntimeSelection> = {},
): RequestedRuntimeSelection => ({
  provider: "runner-primary",
  codingAgent: "codex",
  aiProvider: "openai",
  model: "gpt-5.6-sol",
  authClass: "api_key",
  capabilities: [],
  ...overrides,
});

describe("resolveRequestedRuntimeSelection", () => {
  it("admits an exact modern request without rewriting any explicit field", () => {
    const result = resolveRequestedRuntimeSelection(
      modernRequest({
        provider: "Runner-Lane-A",
        authClass: "provider_oauth",
        capabilities: ["mcp", "sandbox"],
      }),
    );

    expect(result).toEqual({
      admitted: true,
      selection: {
        schemaVersion: "resolved-runtime-selection-v1",
        registryVersion: 1,
        projectionHash: runtimeCapabilityRegistry.projectionHash,
        provider: "Runner-Lane-A",
        codingAgent: "codex",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
        authClass: "provider_oauth",
        capabilities: ["mcp", "sandbox"],
        provenance: {
          provider: "explicit",
          codingAgent: "explicit",
          aiProvider: "explicit",
          model: "explicit",
          authClass: "explicit",
          capabilities: "explicit",
        },
      },
    });
  });

  it("keeps infrastructure provider independent from executor and AI provider", () => {
    const result = resolveRequestedRuntimeSelection(
      modernRequest({ provider: "claude-code" }),
    );

    expect(result).toMatchObject({
      admitted: true,
      selection: {
        provider: "claude-code",
        codingAgent: "codex",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
      },
    });
  });

  it("returns the authoritative typed Pi-disabled rejection unchanged", () => {
    const request = modernRequest({
      codingAgent: "pi",
      aiProvider: "anthropic",
      model: "claude-opus-5",
    });
    const expected = runtimeCapabilityRegistry.admit(request);

    expect(resolveRequestedRuntimeSelection(request)).toEqual(expected);
    expect(expected).toMatchObject({
      admitted: false,
      code: "RUNTIME_ADMISSION_DISABLED",
    });
  });

  it("fails closed with the registry rejection for an unknown modern coding agent", () => {
    const request = modernRequest({ codingAgent: "future-agent" });
    const expected = runtimeCapabilityRegistry.admit(request);

    expect(resolveRequestedRuntimeSelection(request)).toEqual(expected);
    expect(expected).toMatchObject({
      admitted: false,
      code: "RUNTIME_CODING_AGENT_UNSUPPORTED",
    });
  });

  it("keeps modern values exact and case-sensitive", () => {
    expect(
      resolveRequestedRuntimeSelection(modernRequest({ codingAgent: "Codex" })),
    ).toMatchObject({
      admitted: false,
      code: "RUNTIME_CODING_AGENT_UNSUPPORTED",
    });
    expect(
      resolveRequestedRuntimeSelection(modernRequest({ model: "GPT-5.6-SOL" })),
    ).toMatchObject({
      admitted: false,
      code: "RUNTIME_MODEL_UNSUPPORTED",
    });
  });

  it("deeply freezes the resolved selection and records per-field provenance", () => {
    const result = resolveRequestedRuntimeSelection(
      modernRequest({ capabilities: ["browser"] }),
    );

    expect(result.admitted).toBe(true);
    if (!result.admitted) return;

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selection)).toBe(true);
    expect(Object.isFrozen(result.selection.capabilities)).toBe(true);
    expect(Object.isFrozen(result.selection.provenance)).toBe(true);
    expect(result.selection.provenance).toEqual({
      provider: "explicit",
      codingAgent: "explicit",
      aiProvider: "explicit",
      model: "explicit",
      authClass: "explicit",
      capabilities: "explicit",
    });
  });
});

describe("resolveRuntime", () => {
  it("preserves Community's claude-code legacy default", () => {
    expect(resolveRuntime({})).toEqual({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("accepts anthropic as an alias with the same legacy default", () => {
    expect(resolveRuntime({ provider: "anthropic" })).toEqual({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("preserves Community's Codex and Zipu defaults", () => {
    expect(resolveRuntime({ provider: "codex" }).model).toBe("gpt-5.6-sol");
    expect(resolveRuntime({ provider: "zipu" }).model).toBe("glm-5.2");
  });

  it("keeps an explicit legacy GLM model over the provider default", () => {
    expect(resolveRuntime({ provider: "zipu", model: "glm-5.3" }).model).toBe(
      "glm-5.3",
    );
  });

  it("maps grok provider to OpenCode over xAI with the current Grok coding default", () => {
    expect(resolveRuntime({ provider: "grok" })).toEqual({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      model: "grok-4.3",
    });
  });

  it("accepts xai as an alias for the grok OpenCode runtime", () => {
    expect(resolveRuntime({ provider: "xai", model: "grok-4.20-reasoning" })).toEqual({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      model: "grok-4.20-reasoning",
    });
  });

  it("normalizes codex-cli and infers its legacy provider", () => {
    expect(resolveRuntime({ codingAgent: "CODEX-CLI" })).toEqual({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("fails closed instead of defaulting an unknown non-empty coding agent", () => {
    expect(() => resolveRuntime({ codingAgent: "future-agent" })).toThrow(
      LegacyRuntimeSelectionError,
    );

    try {
      resolveRuntime({ codingAgent: "future-agent" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "RUNTIME_CODING_AGENT_UNSUPPORTED",
        codingAgent: "future-agent",
      });
    }
  });
});
