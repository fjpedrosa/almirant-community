import { describe, expect, it } from "bun:test";
import {
  RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION,
  runtimeCapabilityRegistry,
  type ResolvedRuntimeSelection,
} from "@almirant/shared";
import {
  createRuntimeExecutorRegistry,
  RuntimeExecutorResolutionError,
} from "./registry";

const makeSelection = (
  overrides: Partial<ResolvedRuntimeSelection> = {},
): ResolvedRuntimeSelection => ({
  schemaVersion: RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION,
  registryVersion: runtimeCapabilityRegistry.version,
  projectionHash: runtimeCapabilityRegistry.projectionHash,
  provider: "codex",
  codingAgent: "codex",
  aiProvider: "openai",
  model: "gpt-5.6-sol",
  authClass: "api_key",
  capabilities: [],
  provenance: {
    provider: "explicit",
    codingAgent: "explicit",
    aiProvider: "explicit",
    model: "explicit",
    authClass: "explicit",
    capabilities: "explicit",
  },
  ...overrides,
});

describe("runtime executor registry", () => {
  it("dispatches an admitted modern selection by codingAgent, not provider", () => {
    const registry = createRuntimeExecutorRegistry();
    const executor = registry.admitResolvedRuntimeSelection(
      makeSelection({ provider: "grok" }),
    );

    expect(executor.codingAgent).toBe("codex");
    expect(executor.runtimeType).toBe("codex-shim");
  });

  it("registers Pi with a dedicated sterile shim configuration", () => {
    const registry = createRuntimeExecutorRegistry();
    expect(registry.acceptedCodingAgents).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(Object.isFrozen(registry.acceptedCodingAgents)).toBe(true);

    const executor = registry.resolve({ provider: "claude-code", codingAgent: "pi" });
    expect(executor.resolveRuntimeConfig({
      opencodeImage: "opencode:test",
      claudeShimImage: "claude:test",
      codexShimImage: "codex:test",
      piShimImage: "pi:test",
      servePort: 4096,
    })).toEqual({
      type: "pi-shim",
      image: "pi:test",
      envVars: {
        SHIM_SERVER_HOST: "0.0.0.0",
        SHIM_SERVER_PORT: "4096",
        WORKSPACE_REPO_PATH: "/workspace/repo",
        PI_CODING_AGENT_DIR: "/tmp/almirant-pi-agent",
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
    });
  });

  it("rejects Pi admission before image selection", () => {
    const registry = createRuntimeExecutorRegistry();
    let imageReads = 0;
    const images = new Proxy(
      {
        opencodeImage: "opencode:test",
        claudeShimImage: "claude:test",
        codexShimImage: "codex:test",
        piShimImage: "pi:test",
      },
      {
        get(target, property, receiver) {
          imageReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    let error: unknown;
    try {
      const executor = registry.admitResolvedRuntimeSelection(
        makeSelection({
          provider: "pi",
          codingAgent: "pi",
          authClass: "subscription",
        }),
      );
      executor.resolveRuntimeConfig(images);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RuntimeExecutorResolutionError);
    expect((error as RuntimeExecutorResolutionError).code).toBe(
      "PI_AUTH_SUBSCRIPTION_DISABLED",
    );
    expect(imageReads).toBe(0);
  });

  it("returns safe permanent failure taxonomy without leaking details", () => {
    const error = new RuntimeExecutorResolutionError(
      "RUNTIME_MODEL_UNSUPPORTED",
      "Bearer FAKE_REGISTRY_FAILURE_SECRET at https://private.example.test",
    );

    expect(error).toMatchObject({
      code: "RUNTIME_MODEL_UNSUPPORTED",
      category: "model",
      retryable: false,
      classification: "permanent_config",
      runtimeFailure: {
        schemaVersion: "runtime-failure-v1",
        category: "model",
        retryable: false,
        causeCode: "RUNTIME_MODEL_UNSUPPORTED",
      },
    });
    expect(String(error)).not.toMatch(
      /FAKE_REGISTRY_FAILURE_SECRET|private\.example\.test|Bearer/,
    );
  });

  it("rejects mismatched modern registry identity", () => {
    const registry = createRuntimeExecutorRegistry();

    try {
      registry.admitResolvedRuntimeSelection(
        makeSelection({ projectionHash: "sha256:stale-runner-projection" }),
      );
      throw new Error("expected registry hash rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeExecutorResolutionError);
      expect((error as RuntimeExecutorResolutionError).code).toBe(
        "RUNTIME_REGISTRY_HASH_MISMATCH",
      );
    }
  });

  it("fails closed for unknown or empty explicit coding agents", () => {
    const registry = createRuntimeExecutorRegistry();

    for (const codingAgent of ["unknown-agent", "codex-cli", ""]) {
      try {
        registry.resolve({ provider: "codex", codingAgent });
        throw new Error("expected explicit coding agent rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeExecutorResolutionError);
        expect((error as RuntimeExecutorResolutionError).code).toBe(
          "RUNTIME_CODING_AGENT_UNSUPPORTED",
        );
      }
    }
  });

  it("preserves legacy provider dispatch only when codingAgent is absent", () => {
    const registry = createRuntimeExecutorRegistry();
    const cases = [
      ["claude-code", "claude-code"],
      ["anthropic", "claude-code"],
      ["zipu", "claude-code"],
      ["zai", "claude-code"],
      ["codex", "codex"],
      ["openai", "codex"],
      ["grok", "opencode"],
      ["xai", "opencode"],
    ] as const;

    for (const [provider, codingAgent] of cases) {
      expect(registry.resolve({ provider }).codingAgent).toBe(codingAgent);
    }
    expect(
      registry.resolve({ provider: "zipu", codingAgent: "opencode" }).codingAgent,
    ).toBe("opencode");
  });

  it("fails closed for unknown provider-only history and runtime types", () => {
    const registry = createRuntimeExecutorRegistry();

    for (const provider of ["future-provider", ""]) {
      expect(() => registry.resolve({ provider })).toThrow(
        RuntimeExecutorResolutionError,
      );
    }
    expect(() => registry.resolveByRuntimeType("future-runtime")).toThrow(
      RuntimeExecutorResolutionError,
    );
  });
});
