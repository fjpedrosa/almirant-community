import { describe, expect, test } from "bun:test";
import {
  PI_INBOUND_RECORD_MAX_BYTES,
  PI_OUTBOUND_RECORD_MAX_BYTES,
  assertPiCapabilityContract,
  assertPiFramingCases,
  decodeAlmirantJsonl,
  findSensitiveMaterial,
  materializeFramingCase,
  parsePiLifecycleJsonl,
  serializeAlmirantJsonl,
  type PiCapabilityContract,
} from "./pi-capability-contract-v1.schema";

const fixtureDirectory = `${import.meta.dir}/../fixtures/pi-0.84.2`;

const readJson = async (name: string): Promise<unknown> =>
  Bun.file(`${fixtureDirectory}/${name}`).json();

const readText = async (name: string): Promise<string> =>
  Bun.file(`${fixtureDirectory}/${name}`).text();

const loadContract = async (): Promise<PiCapabilityContract> => {
  const value = await readJson("capability-contract-v1.json");
  assertPiCapabilityContract(value);
  return value;
};

const unique = (values: string[]): boolean => new Set(values).size === values.length;

const expectedProviders = {
  anthropic: {
    displayName: "Anthropic",
    environmentVariable: "ANTHROPIC_API_KEY",
    endpoint: "https://api.anthropic.com",
    apis: ["anthropic-messages"],
    candidateModels: [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-opus-4-7",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ],
    excludedTargetModels: [],
  },
  openai: {
    displayName: "OpenAI API",
    environmentVariable: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1",
    apis: ["openai-responses"],
    candidateModels: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-4.1",
      "gpt-4.1-mini",
    ],
    excludedTargetModels: [],
  },
  google: {
    displayName: "Google",
    environmentVariable: "GEMINI_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    apis: ["google-generative-ai"],
    candidateModels: [
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    excludedTargetModels: [],
  },
  zai: {
    displayName: "Z.AI",
    environmentVariable: "ZAI_API_KEY",
    endpoint: "https://api.z.ai/api/coding/paas/v4",
    apis: ["openai-completions"],
    candidateModels: ["glm-5.3", "glm-5.2", "glm-5-turbo", "glm-4.7"],
    excludedTargetModels: [
      "glm-5.1",
      "glm-5",
      "glm-5v-turbo",
      "glm-4.7-flashx",
      "glm-4.7-flash",
      "glm-4.6",
      "glm-4.5",
      "glm-4.5-air",
      "glm-4.6v",
      "glm-4.6v-flashx",
      "glm-4.6v-flash",
      "glm-ocr",
    ],
  },
  xai: {
    displayName: "xAI",
    environmentVariable: "XAI_API_KEY",
    endpoint: "https://api.x.ai/v1",
    apis: ["openai-completions", "openai-responses"],
    candidateModels: ["grok-4.3", "grok-build-0.1"],
    excludedTargetModels: [
      "grok-4.20-reasoning",
      "grok-4.20-multi-agent",
      "grok-4.20",
    ],
  },
} as const;

const expectedCapabilities = {
  mcp: "PI_CAPABILITY_MCP_DISABLED",
  browser: "PI_CAPABILITY_BROWSER_DISABLED",
  extensions: "PI_CAPABILITY_EXTENSIONS_DISABLED",
  sandbox: "PI_CAPABILITY_SANDBOX_DISABLED",
  permission_enforced: "PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED",
  read_only_enforced: "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED",
} as const;

const expectedAuditSurfaces = [
  "agent_jobs",
  "loops",
  "scheduled_agent_configs",
  "work_items",
  "system_settings.agent_routing",
  "agent_native_events",
];

describe("Pi 0.84.2 capability contract", () => {
  test("pins the package, process isolation, transport, and byte limits", async () => {
    const contract = await loadContract();

    expect(contract.schemaVersion).toBe("pi-capability-contract-v1");
    expect(contract.runtime).toMatchObject({
      packageName: "@earendil-works/pi-coding-agent",
      packageVersion: "0.84.2",
      nodeEngine: ">=22.19.0",
      binary: "pi",
      mode: "rpc",
      configDirectoryPolicy: "new-empty-per-session",
      sessionPersistence: false,
      projectResources: false,
      offline: true,
      telemetry: false,
      versionChecks: false,
    });
    expect(contract.runtime.arguments).toEqual([
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--no-context-files",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
    ]);
    expect(contract.runtime.environment).toEqual({
      PI_CODING_AGENT_DIR: "runtime-config",
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
    });
    expect(contract.framing).toMatchObject({
      recordDelimiter: "LF",
      acceptsCrlfInput: true,
      unicodeLineSeparatorsAreContent: true,
      finalLfRequired: true,
      objectRecordsOnly: true,
      inboundMaxBytes: PI_INBOUND_RECORD_MAX_BYTES,
      outboundMaxBytes: PI_OUTBOUND_RECORD_MAX_BYTES,
      failureScope: "session",
    });
    expect(PI_INBOUND_RECORD_MAX_BYTES).toBe(262_144);
    expect(PI_OUTBOUND_RECORD_MAX_BYTES).toBe(4_194_304);
  });

  test("freezes one response per command and sole normal settlement semantics", async () => {
    const contract = await loadContract();

    expect(contract.rpc.commands).toEqual([
      { type: "get_state", responseCardinality: "exactly-one-correlated" },
      { type: "set_model", responseCardinality: "exactly-one-correlated" },
      { type: "prompt", responseCardinality: "exactly-one-correlated" },
      { type: "abort", responseCardinality: "exactly-one-correlated" },
      { type: "get_session_stats", responseCardinality: "exactly-one-correlated" },
    ]);
    expect(contract.rpc.normalTerminal).toBe("agent_settled");
    expect(contract.rpc.nonTerminals).toContain("agent_end");
    expect(contract.rpc.abortAcknowledgementIsTerminal).toBe(false);
    expect(contract.rpc.duplicateTerminalPolicy).toBe("ignore-after-first");
    expect(contract.rpc.abnormalTerminalClasses.map((entry) => entry.class)).toEqual([
      "protocol_error",
      "process_exit",
      "process_signal",
      "stdin_error",
      "timeout",
      "cancelled",
    ]);
    expect(unique(contract.rpc.abnormalTerminalClasses.map((entry) => entry.code))).toBe(true);
  });

  test("freezes non-additive usage precedence and unknown fallback", async () => {
    const contract = await loadContract();

    expect(contract.usage).toEqual({
      streaming: "cumulative-snapshot-never-sum",
      finalMessage: "per-message-authoritative",
      postSettlementSessionStats: "whole-session-aggregate",
      continuedTurns: "subtract-pre-turn-session-baseline",
      reasoning: "subset-of-output",
      unavailable: "unknown-never-zero-filled",
      precedence: [
        "post-settlement-session-stats-delta",
        "deduplicated-final-message",
        "unknown",
      ],
    });
  });

  test("enables only the canonical Z.AI GLM-5.3 API-key production row", async () => {
    const contract = await loadContract();

    expect(contract.authClasses.map((entry) => entry.id)).toEqual([
      "api_key",
      "setup_token",
      "provider_oauth",
      "subscription",
    ]);
    expect(contract.authClasses.filter((entry) => entry.admissionEnabled)).toEqual([
      expect.objectContaining({
        id: "api_key",
        documentationCandidate: true,
        rejectionCode: null,
      }),
    ]);
    expect(
      contract.authClasses
        .filter((entry) => entry.id !== "api_key")
        .every(
          (entry) =>
            entry.documentationCandidate === false &&
            entry.admissionEnabled === false,
        ),
    ).toBe(true);

    expect(contract.providers.map((entry) => entry.aiProvider)).toEqual(Object.keys(expectedProviders));
    for (const provider of contract.providers) {
      const expected = expectedProviders[provider.aiProvider as keyof typeof expectedProviders];
      const isEnabledProvider = provider.aiProvider === "zai";
      expect(provider).toMatchObject({
        ...expected,
        piProvider: provider.aiProvider,
        authClass: "api_key",
        admittedModels: isEnabledProvider ? ["glm-5.3"] : [],
        runtimeVerified: isEnabledProvider,
        admissionEnabled: isEnabledProvider,
      });
      expect(provider.candidateModelApis).toEqual(
        Object.fromEntries(provider.candidateModels.map((model) => [model, expected.apis[0]])),
      );
      expect(new Set(provider.targetCatalogModels)).toEqual(
        new Set([...provider.candidateModels, ...provider.excludedTargetModels]),
      );
      expect(
        provider.targetCatalogModels.filter((model) => provider.candidateModels.includes(model)),
      ).toEqual(provider.candidateModels);
    }
    expect(
      contract.providers.flatMap((provider) =>
        provider.admittedModels.map((model) => `${provider.aiProvider}/${model}`)
      ),
    ).toEqual(["zai/glm-5.3"]);
    expect(contract.providers.some((entry) => entry.piProvider === "openai-codex")).toBe(false);
  });

  test("keeps every unsupported capability and custom provider path fail-closed", async () => {
    const contract = await loadContract();

    expect(contract.capabilities.map((entry) => entry.id)).toEqual(Object.keys(expectedCapabilities));
    for (const capability of contract.capabilities) {
      expect(capability.enabled).toBe(false);
      expect(capability.rejectionCode).toBe(
        expectedCapabilities[capability.id as keyof typeof expectedCapabilities],
      );
    }
    expect(contract.customProviders).toEqual({
      enabled: false,
      rejectionCode: "PI_CUSTOM_PROVIDER_DISABLED",
      unsafeInputs: ["endpoint", "headers", "environment", "command-resolution"],
      enablementPrerequisites: [
        "trusted-profile",
        "redirect-revalidation",
        "egress-policy",
        "secret-policy",
      ],
    });
  });

  test("has unique provenance/provider/capability records and a complete persisted audit", async () => {
    const contract = await loadContract();

    expect(unique(contract.provenance.map((entry) => entry.id))).toBe(true);
    expect(unique(contract.provenance.map((entry) => `${entry.scope}:${entry.path}`))).toBe(true);
    expect(unique(contract.providers.map((entry) => entry.aiProvider))).toBe(true);
    expect(unique(contract.capabilities.map((entry) => entry.id))).toBe(true);
    expect(contract.persistedSurfaceAudit.map((entry) => entry.surface)).toEqual(
      expectedAuditSurfaces,
    );
    expect(contract.persistedSurfaceAudit.every((entry) => entry.auditStatus === "documented")).toBe(true);
    expect(contract.persistedSurfaceAudit.every((entry) => entry.defaults !== undefined)).toBe(true);
    expect(contract.persistedSurfaceAudit.every((entry) => entry.nullability !== undefined)).toBe(true);
    expect(contract.persistedSurfaceAudit.every((entry) => entry.currentConflict.length > 0)).toBe(true);
  });

  test("runtime validation rejects invalid shapes, duplicates, sensitive material, and extra enabled rows", async () => {
    const contract = await loadContract();

    const invalidShape = structuredClone(contract) as unknown as Record<string, unknown>;
    invalidShape.schemaVersion = 1;
    expect(() => assertPiCapabilityContract(invalidShape)).toThrow("schemaVersion");

    const duplicateProvider = structuredClone(contract);
    duplicateProvider.providers.push(structuredClone(duplicateProvider.providers[0]!));
    expect(() => assertPiCapabilityContract(duplicateProvider)).toThrow("duplicate provider");

    const duplicateCapability = structuredClone(contract);
    duplicateCapability.capabilities.push(structuredClone(duplicateCapability.capabilities[0]!));
    expect(() => assertPiCapabilityContract(duplicateCapability)).toThrow("duplicate capability");

    const duplicateProvenance = structuredClone(contract);
    duplicateProvenance.provenance.push(structuredClone(duplicateProvenance.provenance[0]!));
    expect(() => assertPiCapabilityContract(duplicateProvenance)).toThrow("duplicate provenance");

    const enabledProvider = structuredClone(contract);
    enabledProvider.providers[0]!.runtimeVerified = true;
    enabledProvider.providers[0]!.admissionEnabled = true;
    enabledProvider.providers[0]!.admittedModels = [
      enabledProvider.providers[0]!.candidateModels[0]!,
    ];
    expect(() => assertPiCapabilityContract(enabledProvider)).toThrow(
      "only zai/glm-5.3",
    );

    const unverifiedProvider = structuredClone(contract);
    unverifiedProvider.providers.find((entry) => entry.aiProvider === "zai")!
      .runtimeVerified = false;
    expect(() => assertPiCapabilityContract(unverifiedProvider)).toThrow(
      "admissionEnabled",
    );

    const sensitive = { ...contract, secret: "redacted" };
    expect(findSensitiveMaterial(sensitive)).toEqual(["$.secret"]);
    expect(() => assertPiCapabilityContract(sensitive)).toThrow("sensitive material");
  });
});

describe("Pi JSONL framing cases", () => {
  test("accepts only the frozen LF/CRLF/object cases and fails the session otherwise", async () => {
    const casesValue = await readJson("rpc-framing-cases-v1.json");
    assertPiFramingCases(casesValue);

    expect(casesValue.cases.map((entry) => entry.id)).toEqual([
      "lf-object",
      "crlf-object",
      "unicode-separators-content",
      "max-sized-record",
      "malformed-json",
      "null",
      "array",
      "primitive",
      "oversized-record",
      "unterminated-record",
    ]);

    for (const framingCase of casesValue.cases) {
      const wire = materializeFramingCase(framingCase);
      if (framingCase.expected.accepted) {
        expect(decodeAlmirantJsonl(wire)).toHaveLength(framingCase.expected.records);
      } else {
        expect(() => decodeAlmirantJsonl(wire)).toThrow(framingCase.expected.code);
        expect(framingCase.expected.failureScope).toBe("session");
      }
    }
  });

  test("treats U+2028/U+2029 as content and always emits final LF", () => {
    const value = { type: "prompt", message: "alpha\u2028beta\u2029gamma" };
    const wire = serializeAlmirantJsonl(value);

    expect(wire.at(-1)).toBe(0x0a);
    expect(decodeAlmirantJsonl(wire)).toEqual([value]);
  });
});

describe("schema-derived Pi lifecycle", () => {
  test("orders correlated responses, lifecycle, sole terminal, and final usage", async () => {
    const text = await readText("rpc-lifecycle-v1.jsonl");
    const lifecycle = parsePiLifecycleJsonl(text);
    const records = lifecycle.map((entry) => entry.record);

    expect(lifecycle.every((entry) => entry.runtimeCaptured === false)).toBe(true);
    expect(lifecycle.every((entry) => entry.basis === "schema-derived")).toBe(true);
    expect(lifecycle.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: lifecycle.length }, (_, index) => index + 1),
    );

    for (const command of ["get_state", "set_model", "prompt", "abort", "get_session_stats"]) {
      const responses = records.filter(
        (record) => record.type === "response" && record.command === command,
      );
      expect(responses).toHaveLength(1);
      expect(typeof responses[0]!.id).toBe("string");
    }

    const indexOf = (type: string): number => records.findIndex((record) => record.type === type);
    expect(indexOf("agent_start")).toBeGreaterThan(indexOf("prompt"));
    expect(indexOf("turn_start")).toBeGreaterThan(indexOf("agent_start"));
    expect(indexOf("message_start")).toBeGreaterThan(indexOf("turn_start"));
    expect(indexOf("message_end")).toBeGreaterThan(indexOf("message_start"));
    expect(indexOf("turn_end")).toBeGreaterThan(indexOf("message_end"));
    expect(indexOf("agent_end")).toBeGreaterThan(indexOf("turn_end"));
    expect(indexOf("agent_settled")).toBeGreaterThan(indexOf("agent_end"));

    expect(records.filter((record) => record.type === "agent_settled")).toHaveLength(1);
    expect(records.filter((record) => record.type === "agent_end")).toHaveLength(1);

    const updates = records.filter((record) => record.type === "message_update");
    const updateOutputs = updates.map((record) => record.usage!.output);
    expect(updateOutputs).toEqual([1, 3]);
    expect(updateOutputs.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(
      updateOutputs.at(-1)!,
    );

    const finalMessage = records.find((record) => record.type === "message_end")!.message!;
    if (typeof finalMessage === "string") {
      throw new Error("message_end message must be an object");
    }
    expect(finalMessage.usage).toMatchObject({
      input: 12,
      output: 4,
      reasoning: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 16,
    });
    expect(finalMessage.usage!.reasoning).toBeLessThanOrEqual(finalMessage.usage!.output);

    const statsIndex = records.findIndex(
      (record) => record.type === "response" && record.command === "get_session_stats",
    );
    expect(statsIndex).toBeGreaterThan(indexOf("agent_settled"));
    expect(records[statsIndex]!.data!.tokens).toEqual({
      input: 12,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      total: 16,
    });
  });

  test("rejects message values that do not match their lifecycle record type", async () => {
    const lifecycle = parsePiLifecycleJsonl(await readText("rpc-lifecycle-v1.jsonl"));
    const toJsonl = (entries: typeof lifecycle): string =>
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

    const objectPrompt = structuredClone(lifecycle);
    objectPrompt.find((entry) => entry.record.type === "prompt")!.record.message = {
      role: "user",
      content: [],
    };
    expect(() => parsePiLifecycleJsonl(toJsonl(objectPrompt))).toThrow(
      "$[4].record.message: expected string",
    );

    for (const [type, path] of [
      ["message_start", "$[8]"],
      ["message_end", "$[20]"],
    ] as const) {
      const stringMessage = structuredClone(lifecycle);
      stringMessage.find((entry) => entry.record.type === type)!.record.message =
        "unexpected string";
      expect(() => parsePiLifecycleJsonl(toJsonl(stringMessage))).toThrow(
        `${path}.record.message: expected object`,
      );
    }
  });

  test("contains no secret-like material or user-specific absolute path", async () => {
    const [contract, framing, lifecycleText] = await Promise.all([
      readJson("capability-contract-v1.json"),
      readJson("rpc-framing-cases-v1.json"),
      readText("rpc-lifecycle-v1.jsonl"),
    ]);
    const lifecycle = parsePiLifecycleJsonl(lifecycleText);

    expect(findSensitiveMaterial(contract)).toEqual([]);
    expect(findSensitiveMaterial(framing)).toEqual([]);
    expect(findSensitiveMaterial(lifecycle)).toEqual([]);
    expect(`${JSON.stringify(contract)}${JSON.stringify(framing)}${lifecycleText}`).not.toMatch(
      /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\)/,
    );
  });
});
