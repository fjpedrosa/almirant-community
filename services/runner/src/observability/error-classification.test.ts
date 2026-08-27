import { describe, expect, it } from "bun:test";
import {
  createRuntimeFailure,
  type RuntimeFailureCode,
} from "@almirant/shared";
import { mapErrorCategory } from "./error-classification";

describe("mapErrorCategory", () => {
  it("does not declare an unused container-failure-signal parameter", () => {
    expect(mapErrorCategory.length).toBe(1);
  });

  it("consumes typed taxonomy evidence before raw error text", () => {
    const failure = createRuntimeFailure("RUNTIME_AUTH_FAILURE", {
      causeCode: "PI_AUTH_SUBSCRIPTION_DISABLED",
    });
    const error = Object.assign(
      new Error(
        "timeout Bearer FAKE_CLASSIFIER_SECRET_123456 https://private.example.test",
      ),
      { runtimeFailure: failure },
    );

    expect(mapErrorCategory(error)).toEqual({
      errorCode: "PI_AUTH_SUBSCRIPTION_DISABLED",
      errorCategory: "config",
      recoverable: false,
      failureCategory: "auth",
      retryable: false,
      runtimeFailure: failure,
    });
    expect(JSON.stringify(mapErrorCategory(error))).not.toMatch(
      /FAKE_CLASSIFIER_SECRET|private\.example\.test|Bearer/,
    );
  });

  it("table-classifies all eight categories and retries only explicit process failures", () => {
    const cases = [
      ["RUNTIME_AUTH_FAILURE", "auth", "config", false],
      ["RUNTIME_MODEL_FAILURE", "model", "config", false],
      ["RUNTIME_ENDPOINT_FAILURE", "endpoint", "config", false],
      ["RUNTIME_PROTOCOL_FAILURE", "protocol", "infra", false],
      ["RUNTIME_PROCESS_FAILURE", "process", "infra", true],
      ["RUNTIME_CANCELLED", "cancellation", "infra", false],
      ["RUNTIME_USAGE_INTEGRITY_FAILURE", "usage", "agent", false],
      ["RUNTIME_POLICY_FAILURE", "policy", "config", false],
    ] as const satisfies readonly (
      readonly [RuntimeFailureCode, string, string, boolean]
    )[];

    for (const [code, failureCategory, errorCategory, retryable] of cases) {
      const failure = createRuntimeFailure(code, { retryable });
      expect(mapErrorCategory(failure)).toMatchObject({
        errorCode: code,
        errorCategory,
        recoverable: retryable,
        failureCategory,
        retryable,
        runtimeFailure: failure,
      });
    }
  });

  it("fails closed for malformed typed payloads instead of reading raw text", () => {
    expect(
      mapErrorCategory({
        runtimeFailure: {
          schemaVersion: "runtime-failure-v1",
          code: "RUNTIME_CANCELLED",
          category: "process",
          retryable: true,
          message: "Bearer FAKE_MALFORMED_CLASSIFIER_SECRET_123456",
        },
        message: "timeout at https://private.example.test",
      }),
    ).toEqual({
      errorCode: "unknown",
      errorCategory: "agent",
      recoverable: false,
    });
  });

  it("preserves the Claude/Codex/OpenCode legacy category fallback", () => {
    expect(mapErrorCategory("recoverable_oom")).toEqual({
      errorCode: "oom",
      errorCategory: "infra",
      recoverable: true,
    });
    expect(mapErrorCategory("recoverable_timeout")).toEqual({
      errorCode: "timeout",
      errorCategory: "infra",
      recoverable: true,
    });
    expect(mapErrorCategory("recoverable_disconnect")).toEqual({
      errorCode: "disconnect",
      errorCategory: "infra",
      recoverable: true,
    });
    expect(mapErrorCategory("permanent_auth")).toEqual({
      errorCode: "auth_failed",
      errorCategory: "config",
      recoverable: false,
    });
    expect(mapErrorCategory("permanent_config")).toEqual({
      errorCode: "bad_config",
      errorCategory: "config",
      recoverable: false,
    });
  });
});
