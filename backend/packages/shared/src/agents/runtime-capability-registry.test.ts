import { describe, expect, it } from "bun:test";
import {
  runtimeCapabilityRegistry,
  type RuntimeAdmissionRequest,
  type RuntimeAdmissionResult,
  type RuntimeAuthClass,
  type RuntimeCapabilityId,
  type RuntimeCapabilityRegistry,
  type RuntimeRejectionCode,
} from "./runtime-capability-registry";

const piFixturePath = `${import.meta.dir}/../../../../../services/runner/test/fixtures/pi-0.84.2/capability-contract-v1.json`;

interface PiFixture {
  authClasses: Array<{
    id: RuntimeAuthClass;
    admissionEnabled: boolean;
    rejectionCode: string | null;
  }>;
  providers: Array<{
    aiProvider: string;
    authClass: RuntimeAuthClass;
    candidateModels: string[];
    admittedModels: string[];
    runtimeVerified: boolean;
    admissionEnabled: boolean;
  }>;
  capabilities: Array<{
    id: RuntimeCapabilityId;
    enabled: false;
    rejectionCode: string;
  }>;
  customProviders: {
    enabled: false;
    rejectionCode: string;
  };
}

const loadPiFixture = async (): Promise<PiFixture> =>
  Bun.file(piFixturePath).json() as Promise<PiFixture>;

const request = (
  overrides: Partial<RuntimeAdmissionRequest> = {},
): RuntimeAdmissionRequest => ({
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  authClass: "api_key",
  capabilities: [],
  ...overrides,
});

const expectRejected = (
  result: RuntimeAdmissionResult,
  code: RuntimeRejectionCode,
): void => {
  expect(result.admitted).toBe(false);
  if (!result.admitted) expect(result.code).toBe(code);
};

const existingCombinations = [
  ["claude-code", "anthropic"],
  ["codex", "openai"],
  ["opencode", "openai"],
  ["claude-code", "zai"],
  ["opencode", "zai"],
  ["opencode", "xai"],
] as const;

describe("runtime capability registry", () => {
  it("exports the typed, environment-neutral registry contract", () => {
    const registry: RuntimeCapabilityRegistry = runtimeCapabilityRegistry;
    const authClass: RuntimeAuthClass = "api_key";
    const capability: RuntimeCapabilityId = "mcp";

    expect(registry.schemaVersion).toBe("runtime-capability-registry-v1");
    expect(registry.version).toBe(1);
    expect(registry.projectionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(authClass).toBe("api_key");
    expect(capability).toBe("mcp");
  });

  it("preserves every existing coding-agent/provider/model admission", () => {
    for (const [codingAgent, aiProvider] of existingCombinations) {
      const models = runtimeCapabilityRegistry.getModels(aiProvider);
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        const result = runtimeCapabilityRegistry.admit(
          request({ codingAgent, aiProvider, model: model.id }),
        );
        expect(result).toMatchObject({
          admitted: true,
          selection: { codingAgent, aiProvider, model: model.id, authClass: "api_key" },
        });
      }
    }
  });

  it("preserves Community defaults while adding GLM-5.3 for Pi admission", () => {
    expect(runtimeCapabilityRegistry.getDefaultModel("anthropic")).toBe("claude-opus-5");
    expect(runtimeCapabilityRegistry.getDefaultModel("openai")).toBe("gpt-5.6-sol");
    expect(runtimeCapabilityRegistry.getDefaultModel("google")).toBe("gemini-3.1-pro-preview");
    expect(runtimeCapabilityRegistry.getDefaultModel("zai")).toBe("glm-5.2");
    expect(runtimeCapabilityRegistry.getDefaultModel("xai")).toBe("grok-4.3");
    expect(runtimeCapabilityRegistry.getModels("zai").map(({ id }) => id)).toContain("glm-5.3");
  });

  it("keeps modern admission exact, case-sensitive, and non-rewriting", () => {
    const exactModel = "gpt-5.6-sol";
    const result = runtimeCapabilityRegistry.admit(
      request({ codingAgent: "codex", aiProvider: "openai", model: exactModel }),
    );

    expect(result).toMatchObject({
      admitted: true,
      selection: { model: exactModel },
    });
    expectRejected(
      runtimeCapabilityRegistry.admit(
        request({ codingAgent: "codex", aiProvider: "openai", model: "GPT-5.6-SOL" }),
      ),
      "RUNTIME_MODEL_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(
        request({ codingAgent: "Codex", aiProvider: "openai", model: exactModel }),
      ),
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(
        request({ codingAgent: "codex", aiProvider: "OpenAI", model: exactModel }),
      ),
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
    );
  });

  it("returns a typed generic reason for every unsupported admission dimension", () => {
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ codingAgent: "future-agent" })),
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(
        request({ codingAgent: "codex", aiProvider: "anthropic" }),
      ),
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ model: "unknown-model" })),
      "RUNTIME_MODEL_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ authClass: "future_auth" })),
      "RUNTIME_AUTH_CLASS_UNSUPPORTED",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ capabilities: ["future_capability"] })),
      "RUNTIME_CAPABILITY_UNSUPPORTED",
    );
  });

  it("fails closed on registry version and projection hash mismatches", () => {
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ registryVersion: 2 })),
      "RUNTIME_REGISTRY_VERSION_MISMATCH",
    );
    expectRejected(
      runtimeCapabilityRegistry.admit(request({ projectionHash: "sha256:stale" })),
      "RUNTIME_REGISTRY_HASH_MISMATCH",
    );
  });

  it("enables only the production-verified Pi Z.AI GLM-5.3 API-key tuple", async () => {
    const fixture = await loadPiFixture();
    const piTuples = runtimeCapabilityRegistry.tuples.filter(
      (tuple) => tuple.codingAgent === "pi",
    );

    for (const provider of fixture.providers) {
      const tuples = piTuples.filter((tuple) => tuple.aiProvider === provider.aiProvider);
      expect(tuples.map((tuple) => tuple.model)).toEqual(
        [...provider.candidateModels].sort(),
      );
      expect(tuples.every((tuple) =>
        tuple.authClasses.length === 1 && tuple.authClasses[0] === provider.authClass
      )).toBe(true);

      for (const tuple of tuples) {
        const enabled = provider.admittedModels.includes(tuple.model);
        expect(tuple.runtimeVerified).toBe(enabled);
        expect(tuple.admissionEnabled).toBe(enabled);
        expect(tuple.rejectionCode).toBe(
          enabled ? null : "RUNTIME_ADMISSION_DISABLED",
        );

        const result = runtimeCapabilityRegistry.admit(
          request({
            codingAgent: "pi",
            aiProvider: provider.aiProvider,
            model: tuple.model,
          }),
        );
        if (enabled) {
          expect(result).toMatchObject({
            admitted: true,
            selection: {
              codingAgent: "pi",
              aiProvider: "zai",
              model: "glm-5.3",
              authClass: "api_key",
              capabilities: [],
            },
          });
        } else {
          expectRejected(result, "RUNTIME_ADMISSION_DISABLED");
        }
      }
    }

    expect(
      piTuples.filter((tuple) => tuple.admissionEnabled),
    ).toEqual([
      expect.objectContaining({
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        authClasses: ["api_key"],
        runtimeVerified: true,
        rejectionCode: null,
      }),
    ]);
    expect(new Set(piTuples.map((tuple) => tuple.aiProvider))).toEqual(
      new Set(fixture.providers.map((provider) => provider.aiProvider)),
    );
  });

  it("enables only Pi API-key auth and keeps capability/custom modes fail-closed", async () => {
    const fixture = await loadPiFixture();
    const piBase = {
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    } as const;

    expect(fixture.authClasses.filter((entry) => entry.admissionEnabled)).toEqual([
      expect.objectContaining({ id: "api_key", rejectionCode: null }),
    ]);
    for (const authClass of fixture.authClasses) {
      if (authClass.id === "api_key") continue;
      expectRejected(
        runtimeCapabilityRegistry.admit(request({ ...piBase, authClass: authClass.id })),
        authClass.rejectionCode as RuntimeRejectionCode,
      );
    }

    for (const capability of fixture.capabilities) {
      expectRejected(
        runtimeCapabilityRegistry.admit(
          request({ ...piBase, capabilities: [capability.id] }),
        ),
        capability.rejectionCode as RuntimeRejectionCode,
      );
    }

    const customProviderRows: Array<{
      label: string;
      selection: Partial<RuntimeAdmissionRequest>;
    }> = [
      {
        label: "free-form custom endpoint on the admitted provider",
        selection: { ...piBase, customProvider: true },
      },
      {
        label: "custom provider identity",
        selection: { ...piBase, aiProvider: "custom" },
      },
      {
        label: "redirect-like custom provider profile before model validation",
        selection: {
          ...piBase,
          aiProvider: "custom",
          model: "redirect-profile",
          customProvider: true,
        },
      },
    ];
    for (const { selection } of customProviderRows) {
      expectRejected(
        runtimeCapabilityRegistry.admit(request(selection)),
        fixture.customProviders.rejectionCode as RuntimeRejectionCode,
      );
    }
  });

  it("keeps Google known without enabling a non-Pi provider lane", () => {
    expect(runtimeCapabilityRegistry.aiProviders).toContain("google");
    expect(runtimeCapabilityRegistry.getModels("google").length).toBeGreaterThan(0);
    expect(
      runtimeCapabilityRegistry.tuples.some(
        (tuple) =>
          tuple.aiProvider === "google" &&
          tuple.codingAgent !== "pi" &&
          tuple.admissionEnabled,
      ),
    ).toBe(false);
  });

  it("contains unique canonical tuples and rejection codes", () => {
    const tupleKeys = runtimeCapabilityRegistry.tuples.map(
      (tuple) => `${tuple.codingAgent}\u0000${tuple.aiProvider}\u0000${tuple.model}`,
    );

    expect(new Set(tupleKeys).size).toBe(tupleKeys.length);
    expect(new Set(runtimeCapabilityRegistry.rejectionCodes).size).toBe(
      runtimeCapabilityRegistry.rejectionCodes.length,
    );
  });

  it("has no Node, Bun, database, or frontend dependency in production registry source", async () => {
    const source = await Bun.file(`${import.meta.dir}/runtime-capability-registry.ts`).text();

    expect(source).not.toMatch(/from\s+["'](?:node:|bun:)/);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:database|frontend)[^"']*["']/);
    expect(source).not.toMatch(/\b(?:Bun|process)\./);
  });
});
