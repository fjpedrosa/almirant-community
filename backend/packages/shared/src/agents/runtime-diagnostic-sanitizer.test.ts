import { describe, expect, it } from "bun:test";
import {
  RUNTIME_DIAGNOSTIC_LIMITS,
  RuntimeDiagnosticSanitizationError,
  RuntimeIdentityValidationError,
  fingerprintRuntimeIdentity,
  isSafeRuntimeIdentity,
  normalizeRuntimeIdentity,
  sanitizeRuntimeDiagnostic,
  safeSanitizeRuntimeDiagnostic,
} from "./runtime-diagnostic-sanitizer";

const expectSanitizationError = (
  value: unknown,
  code: RuntimeDiagnosticSanitizationError["code"],
): void => {
  const result = safeSanitizeRuntimeDiagnostic(value);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBeInstanceOf(RuntimeDiagnosticSanitizationError);
    expect(result.error.code).toBe(code);
    expect(result.error.message).toBe(`Runtime diagnostic rejected: ${code}`);
    expect(result.error.message.length).toBeLessThan(128);
  }
  expect(() => sanitizeRuntimeDiagnostic(value)).toThrow(
    RuntimeDiagnosticSanitizationError,
  );
};

describe("runtime diagnostic sanitizer", () => {
  it("recursively redacts sensitive keys and credential content while preserving normal assistant text", () => {
    const sanitized = sanitizeRuntimeDiagnostic({
      type: "text_update",
      delta: "Normal assistant text remains intact.",
      nested: {
        command: "printf FAKE_COMMAND_SENTINEL",
        args: [{ value: "FAKE_ARGUMENT_SENTINEL" }],
        result: { output: "FAKE_RESULT_SENTINEL" },
        config: { endpoint: "https://user:pass@example.test/path?token=FAKE_URL_SENTINEL" },
        headers: { authorization: "Bearer FAKE_BEARER_SENTINEL_123456" },
        env: { API_KEY: "sk-FAKE_API_KEY_SENTINEL_123456" },
        logs: ["FAKE_LOG_SENTINEL"],
      },
      note: "See https://user:pass@example.test/path?q=FAKE_QUERY_SENTINEL with Bearer FAKE_INLINE_BEARER_123456 and api_key=sk-FAKE_INLINE_KEY_123456.",
    });
    const serialized = JSON.stringify(sanitized);

    expect((sanitized as { delta: string }).delta).toBe(
      "Normal assistant text remains intact.",
    );
    expect(serialized).not.toMatch(
      /FAKE_(?:COMMAND|ARGUMENT|RESULT|URL|BEARER|API_KEY|LOG|QUERY|INLINE)/,
    );
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("example.test");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("[redacted-url]");
    expect(serialized).toContain("[redacted-token]");
  });

  it("rejects cycles, excessive depth, node counts, arrays, strings, encoded bytes, and non-plain objects with safe typed errors", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index <= RUNTIME_DIAGNOSTIC_LIMITS.maxDepth; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }

    const tooManyNodes = Array.from(
      { length: RUNTIME_DIAGNOSTIC_LIMITS.maxArrayLength },
      () => Array.from({ length: 8 }, () => null),
    );
    const tooLongArray = Array.from(
      { length: RUNTIME_DIAGNOSTIC_LIMITS.maxArrayLength + 1 },
      () => null,
    );
    const tooLongString = "x".repeat(RUNTIME_DIAGNOSTIC_LIMITS.maxStringBytes + 1);
    const tooManyBytes = Array.from({ length: 5 }, () => "é".repeat(4_000));

    expectSanitizationError(cyclic, "RUNTIME_DIAGNOSTIC_CYCLE");
    expectSanitizationError(deep, "RUNTIME_DIAGNOSTIC_TOO_DEEP");
    expectSanitizationError(tooManyNodes, "RUNTIME_DIAGNOSTIC_TOO_MANY_NODES");
    expectSanitizationError(tooLongArray, "RUNTIME_DIAGNOSTIC_ARRAY_TOO_LARGE");
    expectSanitizationError(tooLongString, "RUNTIME_DIAGNOSTIC_STRING_TOO_LARGE");
    expectSanitizationError(tooManyBytes, "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE");
    expectSanitizationError(new Date(0), "RUNTIME_DIAGNOSTIC_NON_PLAIN_OBJECT");
  });

  it("rejects accessors and unsupported primitive values without evaluating or exposing them", () => {
    let getterCalled = false;
    const accessor = Object.defineProperty({}, "token", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "FAKE_GETTER_SENTINEL";
      },
    });

    expectSanitizationError(accessor, "RUNTIME_DIAGNOSTIC_MALFORMED");
    expectSanitizationError({ value: undefined }, "RUNTIME_DIAGNOSTIC_UNSUPPORTED");
    expect(getterCalled).toBe(false);
  });
});

describe("runtime evidence identity fingerprints", () => {
  it("creates stable SHA-256 opaque identities without retaining raw prefixes, suffixes, or credential-like content", () => {
    const raw = "raw-prefix-sk-FAKE_IDENTITY_SENTINEL_123456-raw-suffix";
    const first = fingerprintRuntimeIdentity(raw);
    const second = fingerprintRuntimeIdentity(raw);

    expect(first).toBe(second);
    expect(first).toMatch(/^rti_sha256_[a-f0-9]{64}$/);
    expect(isSafeRuntimeIdentity(first)).toBe(true);
    expect(first).not.toContain("raw-prefix");
    expect(first).not.toContain("raw-suffix");
    expect(first).not.toContain("FAKE_IDENTITY_SENTINEL");
    expect(normalizeRuntimeIdentity(first)).toBe(first);
    expect(normalizeRuntimeIdentity("synthetic-message-1000")).toMatch(
      /^rti_sha256_[a-f0-9]{64}$/,
    );
  });

  it("rejects empty and oversized identity sources with safe typed errors", () => {
    for (const value of ["", "x".repeat(4_097)]) {
      expect(() => fingerprintRuntimeIdentity(value)).toThrow(
        RuntimeIdentityValidationError,
      );
      try {
        fingerprintRuntimeIdentity(value);
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeIdentityValidationError);
        expect((error as Error).message).toMatch(
          /^Runtime identity rejected: RUNTIME_IDENTITY_/,
        );
        if (value.length > 0) {
          expect((error as Error).message).not.toContain(value.slice(-16));
        }
      }
    }
  });
});
