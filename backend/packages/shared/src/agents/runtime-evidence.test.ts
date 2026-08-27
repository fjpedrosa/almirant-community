import { describe, expect, it } from "bun:test";
import { normalizeRuntimeIdentity } from "./runtime-diagnostic-sanitizer";
import {
  RUNTIME_EVIDENCE_SCHEMA_VERSION,
  RuntimeEvidenceValidationError,
  parseRuntimeEvidence,
  safeParseRuntimeEvidence,
} from "./runtime-evidence";

const firstMessageId = normalizeRuntimeIdentity("timestamp:assistant:1000");
const secondMessageId = normalizeRuntimeIdentity("timestamp:assistant:1001");

const reportedEvidence = {
  schemaVersion: "runtime-evidence-v1",
  usage: {
    status: "reported",
    source: "terminal_aggregate",
    identities: [
      { messageId: firstMessageId },
      { messageId: secondMessageId },
    ],
    inputTokens: 20,
    outputTokens: 8,
    cacheReadTokens: 3,
    cacheWriteTokens: 2,
    reasoningTokens: 3,
    totalTokens: 30,
    cost: {
      totalUsd: 3,
      detail: { input: 1.25, output: 1.75, total: 3 },
    },
  },
  requested: {
    codingAgent: "pi",
    aiProvider: "zai",
    model: "glm-5.3-requested",
    authClass: "api_key",
    capabilities: [],
  },
  resolved: {
    schemaVersion: "resolved-runtime-selection-v1",
    registryVersion: 1,
    projectionHash: "sha256:projection",
    codingAgent: "pi",
    aiProvider: "zai",
    model: "glm-5.3",
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
  },
  observed: {
    codingAgent: "pi",
    aiProvider: "zai",
    model: "glm-5.3",
    reasoningLevel: "high",
  },
  infrastructureProvider: "zipu",
} as const;

describe("runtime evidence trust boundary", () => {
  it("parses one strict versioned report without collapsing selection lanes", () => {
    const parsed = parseRuntimeEvidence(reportedEvidence);

    expect(RUNTIME_EVIDENCE_SCHEMA_VERSION).toBe("runtime-evidence-v1");
    expect(parsed).toEqual(reportedEvidence);
    expect(parsed.requested?.model).toBe("glm-5.3-requested");
    expect(parsed.resolved?.model).toBe("glm-5.3");
    expect(parsed.observed?.aiProvider).toBe("zai");
    expect(parsed.infrastructureProvider).toBe("zipu");
    expect(parsed.usage.status).toBe("reported");
    if (parsed.usage.status === "reported") {
      expect(parsed.usage.reasoningTokens).toBe(3);
      expect(parsed.usage.cost?.detail).toEqual({
        input: 1.25,
        output: 1.75,
        total: 3,
      });
    }
  });

  it("requires opaque generated identities and rejects raw or credential-like identity content", () => {
    const parsed = parseRuntimeEvidence(reportedEvidence);
    expect(parsed.usage.status).toBe("reported");
    if (parsed.usage.status === "reported") {
      expect(parsed.usage.identities).toEqual([
        { messageId: firstMessageId },
        { messageId: secondMessageId },
      ]);
      expect(JSON.stringify(parsed.usage.identities)).not.toMatch(
        /timestamp|assistant|1000|1001/,
      );
    }

    for (const rawIdentity of [
      "timestamp:assistant:1000",
      "Bearer FAKE_EVIDENCE_IDENTITY_SENTINEL_123456",
      "prefix-sk-FAKE_EVIDENCE_API_KEY_123456-suffix",
    ]) {
      const result = safeParseRuntimeEvidence({
        ...reportedEvidence,
        usage: {
          ...reportedEvidence.usage,
          identities: [{ messageId: rawIdentity }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("RUNTIME_EVIDENCE_MALFORMED");
        expect(result.error.message).not.toContain(rawIdentity);
      }
    }
  });

  it("accepts explicit unavailable evidence without fabricated usage", () => {
    const parsed = parseRuntimeEvidence({
      schemaVersion: "runtime-evidence-v1",
      usage: { status: "unavailable", reason: "not_reported" },
      observed: { codingAgent: "pi", aiProvider: "zai", model: "glm-5.3" },
    });

    expect(parsed.usage).toEqual({
      status: "unavailable",
      reason: "not_reported",
    });
    expect(parsed.usage).not.toHaveProperty("totalTokens");
    expect(parsed.usage).not.toHaveProperty("cost");
  });

  it("rejects malformed, negative, non-finite, oversized, and deep evidence without exposing it", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 20; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }

    const expectedCodes = [
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_NON_FINITE",
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_MALFORMED",
      "RUNTIME_EVIDENCE_TOO_LARGE",
      "RUNTIME_EVIDENCE_TOO_LARGE",
      "RUNTIME_EVIDENCE_TOO_DEEP",
    ] as const;
    const invalidValues: unknown[] = [
      { ...reportedEvidence, extra: true },
      {
        ...reportedEvidence,
        usage: { ...reportedEvidence.usage, inputTokens: -1 },
      },
      {
        ...reportedEvidence,
        usage: { ...reportedEvidence.usage, totalTokens: Number.POSITIVE_INFINITY },
      },
      {
        ...reportedEvidence,
        usage: { ...reportedEvidence.usage, totalTokens: 1_000_000_000_001 },
      },
      {
        ...reportedEvidence,
        observed: { codingAgent: "future-agent", aiProvider: "future-ai", model: "future-model" },
        resolved: {
          ...reportedEvidence.resolved,
          codingAgent: "future-agent",
        },
      },
      {
        ...reportedEvidence,
        infrastructureProvider: "zai",
      },
      {
        ...reportedEvidence,
        usage: {
          ...reportedEvidence.usage,
          cost: { detail: { raw: 1 }, unexpected: "secret-value" },
        },
      },
      {
        ...reportedEvidence,
        observed: { codingAgent: "pi", aiProvider: "zai", model: "x".repeat(40_000) },
      },
      {
        ...reportedEvidence,
        requested: {
          ...reportedEvidence.requested,
          capabilities: Array.from(
            { length: 64 },
            () => "\0".repeat(256),
          ),
        },
      },
      deep,
    ];

    for (const [index, value] of invalidValues.entries()) {
      const result = safeParseRuntimeEvidence(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(RuntimeEvidenceValidationError);
        expect(result.error.code).toBe(expectedCodes[index]);
        expect(result.error.message).not.toContain("secret-value");
        expect(result.error.message.length).toBeLessThan(160);
      }
      expect(() => parseRuntimeEvidence(value)).toThrow(
        RuntimeEvidenceValidationError,
      );
    }
  });
});
