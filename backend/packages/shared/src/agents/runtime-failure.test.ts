import { describe, expect, it } from "bun:test";
import { runtimeCapabilityRegistry } from "./runtime-capability-registry";
import {
  RUNTIME_FAILURE_SAFE_MESSAGE_MAX_LENGTH,
  RUNTIME_FAILURE_SCHEMA_VERSION,
  createRuntimeFailure,
  parseRuntimeFailure,
  runtimeFailureCategories,
  runtimeFailureFromPiAdapterCode,
  runtimeFailureFromRuntimeRejectionCode,
  type RuntimeFailureCategory,
  type RuntimeFailureCode,
} from "./runtime-failure";

const CATEGORY_CASES = [
  ["auth", "RUNTIME_AUTH_FAILURE"],
  ["model", "RUNTIME_MODEL_FAILURE"],
  ["endpoint", "RUNTIME_ENDPOINT_FAILURE"],
  ["protocol", "RUNTIME_PROTOCOL_FAILURE"],
  ["process", "RUNTIME_PROCESS_FAILURE"],
  ["cancellation", "RUNTIME_CANCELLED"],
  ["usage", "RUNTIME_USAGE_INTEGRITY_FAILURE"],
  ["policy", "RUNTIME_POLICY_FAILURE"],
] as const satisfies readonly (readonly [RuntimeFailureCategory, RuntimeFailureCode])[];

describe("runtime failure taxonomy", () => {
  it("is versioned and covers exactly the eight runtime failure categories", () => {
    expect(RUNTIME_FAILURE_SCHEMA_VERSION).toBe("runtime-failure-v1");
    expect(runtimeFailureCategories).toEqual(CATEGORY_CASES.map(([category]) => category));

    for (const [category, code] of CATEGORY_CASES) {
      expect(createRuntimeFailure(code)).toMatchObject({
        schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
        code,
        category,
        retryable: false,
      });
    }
  });

  it("allows retry only for a process failure that is explicitly retryable", () => {
    expect(
      createRuntimeFailure("RUNTIME_PROCESS_FAILURE", { retryable: true }),
    ).toMatchObject({ category: "process", retryable: true });
    expect(
      createRuntimeFailure("RUNTIME_PROCESS_FAILURE"),
    ).toMatchObject({ category: "process", retryable: false });
    expect(
      createRuntimeFailure("RUNTIME_CANCELLED", { retryable: true }),
    ).toMatchObject({ category: "cancellation", retryable: false });
    expect(
      createRuntimeFailure("RUNTIME_ENDPOINT_FAILURE", { retryable: true }),
    ).toMatchObject({ category: "endpoint", retryable: false });
  });

  it("reconstructs a bounded safe message instead of retaining raw payload text", () => {
    const rawSecret = "Bearer FAKE_RUNTIME_FAILURE_SECRET_123456 at https://private.example.test";
    const parsed = parseRuntimeFailure({
      ...createRuntimeFailure("RUNTIME_PROTOCOL_FAILURE", {
        causeCode: "PI_RPC_PROTOCOL_ERROR",
      }),
      message: rawSecret.repeat(20),
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.message.length).toBeLessThanOrEqual(
      RUNTIME_FAILURE_SAFE_MESSAGE_MAX_LENGTH,
    );
    expect(JSON.stringify(parsed)).not.toMatch(
      /FAKE_RUNTIME_FAILURE_SECRET|private\.example\.test|Bearer/,
    );
  });

  it("fails closed for malformed failure payloads without retaining their input", () => {
    const valid = createRuntimeFailure("RUNTIME_CANCELLED", {
      causeCode: "PI_RPC_CANCELLED",
    });
    const malformed = [
      null,
      "Bearer FAKE_MALFORMED_FAILURE_SECRET_123456",
      { ...valid, schemaVersion: "runtime-failure-v2" },
      { ...valid, code: "RUNTIME_UNKNOWN" },
      { ...valid, category: "process" },
      { ...valid, retryable: true },
      { ...valid, causeCode: "FAKE_MALFORMED_FAILURE_SECRET_123456" },
      { ...valid, message: 7 },
    ];

    for (const payload of malformed) {
      expect(parseRuntimeFailure(payload)).toBeNull();
    }
  });

  it("maps every public runtime rejection code while preserving it as a safe cause", () => {
    for (const code of runtimeCapabilityRegistry.rejectionCodes) {
      expect(runtimeFailureFromRuntimeRejectionCode(code)).toMatchObject({
        retryable: false,
        causeCode: code,
      });
    }

    expect(
      runtimeFailureFromRuntimeRejectionCode("RUNTIME_MODEL_UNSUPPORTED"),
    ).toMatchObject({ category: "model" });
    expect(
      runtimeFailureFromRuntimeRejectionCode("RUNTIME_AI_PROVIDER_UNSUPPORTED"),
    ).toMatchObject({ category: "endpoint" });
    expect(
      runtimeFailureFromRuntimeRejectionCode("PI_AUTH_SUBSCRIPTION_DISABLED"),
    ).toMatchObject({ category: "auth" });
    expect(
      runtimeFailureFromRuntimeRejectionCode("PI_CAPABILITY_MCP_DISABLED"),
    ).toMatchObject({ category: "policy" });
  });

  it("maps Pi model/protocol/process/cancel/usage/auth/endpoint codes consistently", () => {
    const cases = [
      ["PI_RPC_AUTH_ERROR", "auth", false],
      ["PI_RPC_STATE_MISMATCH", "model", false],
      ["PI_RPC_ENDPOINT_ERROR", "endpoint", false],
      ["PI_RPC_PROTOCOL_ERROR", "protocol", false],
      ["PI_RPC_PROCESS_EXIT", "process", false],
      ["PI_RPC_TIMEOUT", "process", true],
      ["PI_RPC_CANCELLED", "cancellation", false],
      ["PI_RPC_USAGE_INTEGRITY_ERROR", "usage", false],
      ["PI_RPC_CONFIG_ERROR", "policy", false],
    ] as const;

    for (const [causeCode, category, retryable] of cases) {
      expect(runtimeFailureFromPiAdapterCode(causeCode)).toMatchObject({
        category,
        retryable,
        causeCode,
      });
    }
  });
});
