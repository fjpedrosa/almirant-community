import { createHash } from "node:crypto";

export const RUNTIME_DIAGNOSTIC_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: 64,
  maxObjectKeys: 64,
  maxStringBytes: 8_192,
  maxEncodedBytes: 32_768,
});

export const RUNTIME_IDENTITY_LIMITS = Object.freeze({
  maxSourceBytes: 4_096,
});

export type RuntimeDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | readonly RuntimeDiagnosticValue[]
  | { readonly [key: string]: RuntimeDiagnosticValue };

export type RuntimeDiagnosticSanitizationErrorCode =
  | "RUNTIME_DIAGNOSTIC_MALFORMED"
  | "RUNTIME_DIAGNOSTIC_UNSUPPORTED"
  | "RUNTIME_DIAGNOSTIC_NON_PLAIN_OBJECT"
  | "RUNTIME_DIAGNOSTIC_CYCLE"
  | "RUNTIME_DIAGNOSTIC_TOO_DEEP"
  | "RUNTIME_DIAGNOSTIC_TOO_MANY_NODES"
  | "RUNTIME_DIAGNOSTIC_ARRAY_TOO_LARGE"
  | "RUNTIME_DIAGNOSTIC_OBJECT_TOO_LARGE"
  | "RUNTIME_DIAGNOSTIC_STRING_TOO_LARGE"
  | "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE";

export class RuntimeDiagnosticSanitizationError extends Error {
  public readonly code: RuntimeDiagnosticSanitizationErrorCode;

  public constructor(code: RuntimeDiagnosticSanitizationErrorCode) {
    super(`Runtime diagnostic rejected: ${code}`);
    this.name = "RuntimeDiagnosticSanitizationError";
    this.code = code;
  }
}

export type RuntimeIdentityValidationErrorCode =
  | "RUNTIME_IDENTITY_INVALID"
  | "RUNTIME_IDENTITY_TOO_LARGE";

export class RuntimeIdentityValidationError extends Error {
  public readonly code: RuntimeIdentityValidationErrorCode;

  public constructor(code: RuntimeIdentityValidationErrorCode) {
    super(`Runtime identity rejected: ${code}`);
    this.name = "RuntimeIdentityValidationError";
    this.code = code;
  }
}

export type SafeRuntimeIdentity = `rti_sha256_${string}`;

const SAFE_RUNTIME_IDENTITY_PATTERN = /^rti_sha256_[a-f0-9]{64}$/u;
const textEncoder = new TextEncoder();
const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEYS = new Set([
  "command",
  "commands",
  "cmd",
  "arg",
  "args",
  "argument",
  "arguments",
  "inputpreview",
  "outputpreview",
  "result",
  "results",
  "stdout",
  "stderr",
  "config",
  "configuration",
  "settings",
  "header",
  "headers",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "setcookie",
  "url",
  "urls",
  "uri",
  "uris",
  "query",
  "querystring",
  "userinfo",
  "env",
  "environment",
  "environmentvariables",
  "log",
  "logs",
  "logblob",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "secrets",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "key",
  "keys",
  "privatekey",
  "credential",
  "credentials",
]);

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/gu, "");

const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEYS.has(normalizeKey(key));

/** Redacts known credential and URL forms without changing ordinary prose. */
export const redactRuntimeDiagnosticString = (value: string): string =>
  value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
      "[redacted-key]",
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|passphrase|secret|credential|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "[redacted-credential]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/giu, "[redacted-token]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/giu, "[redacted-token]")
    .replace(
      /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{8,}/giu,
      "[redacted-token]",
    )
    .replace(/\bAIza[A-Za-z0-9_-]{16,}/gu, "[redacted-token]")
    .replace(/\bAKIA[A-Z0-9]{12,}/gu, "[redacted-token]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/gu,
      "[redacted-token]",
    )
    .replace(
      /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu,
      "[redacted-url]",
    );

const encodedJsonBytes = (value: string): number =>
  textEncoder.encode(JSON.stringify(value)).byteLength;

export const isSafeRuntimeIdentity = (
  value: unknown,
): value is SafeRuntimeIdentity =>
  typeof value === "string" && SAFE_RUNTIME_IDENTITY_PATTERN.test(value);

/**
 * Produces an opaque, deterministic identity. The source is never retained in
 * the generated identifier and is bounded before hashing.
 */
export const fingerprintRuntimeIdentity = (
  value: string,
): SafeRuntimeIdentity => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeIdentityValidationError("RUNTIME_IDENTITY_INVALID");
  }
  const sourceBytes = textEncoder.encode(value);
  if (sourceBytes.byteLength > RUNTIME_IDENTITY_LIMITS.maxSourceBytes) {
    throw new RuntimeIdentityValidationError("RUNTIME_IDENTITY_TOO_LARGE");
  }
  const digest = createHash("sha256")
    .update("almirant-runtime-identity-v1\0", "utf8")
    .update(sourceBytes)
    .digest("hex");
  return `rti_sha256_${digest}`;
};

export const normalizeRuntimeIdentity = (
  value: string,
): SafeRuntimeIdentity =>
  isSafeRuntimeIdentity(value) ? value : fingerprintRuntimeIdentity(value);

type SanitizerState = {
  nodes: number;
  encodedBytes: number;
  ancestors: Set<object>;
};

const addEncodedBytes = (state: SanitizerState, bytes: number): void => {
  state.encodedBytes += bytes;
  if (state.encodedBytes > RUNTIME_DIAGNOSTIC_LIMITS.maxEncodedBytes) {
    throw new RuntimeDiagnosticSanitizationError(
      "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE",
    );
  }
};

const sanitizedObjectKey = (key: string, index: number): string => {
  if (["__proto__", "prototype", "constructor"].includes(key)) {
    return `[redacted-key-${index}]`;
  }
  return redactRuntimeDiagnosticString(key) === key
    ? key
    : `[redacted-key-${index}]`;
};

/**
 * Clones an unknown diagnostic into bounded JSON-safe data. It rejects cycles,
 * accessors, exotic objects, and unsupported values before returning content.
 */
export const sanitizeRuntimeDiagnostic = (
  root: unknown,
): RuntimeDiagnosticValue => {
  const state: SanitizerState = {
    nodes: 0,
    encodedBytes: 0,
    ancestors: new Set(),
  };

  const visit = (
    value: unknown,
    depth: number,
    redactWholeValue: boolean,
  ): RuntimeDiagnosticValue => {
    if (depth > RUNTIME_DIAGNOSTIC_LIMITS.maxDepth) {
      throw new RuntimeDiagnosticSanitizationError(
        "RUNTIME_DIAGNOSTIC_TOO_DEEP",
      );
    }
    state.nodes += 1;
    if (state.nodes > RUNTIME_DIAGNOSTIC_LIMITS.maxNodes) {
      throw new RuntimeDiagnosticSanitizationError(
        "RUNTIME_DIAGNOSTIC_TOO_MANY_NODES",
      );
    }

    if (typeof value === "string") {
      const valueBytes = textEncoder.encode(value).byteLength;
      if (valueBytes > RUNTIME_DIAGNOSTIC_LIMITS.maxStringBytes) {
        throw new RuntimeDiagnosticSanitizationError(
          "RUNTIME_DIAGNOSTIC_STRING_TOO_LARGE",
        );
      }
      addEncodedBytes(state, encodedJsonBytes(value));
      return redactWholeValue
        ? REDACTED_VALUE
        : redactRuntimeDiagnosticString(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RuntimeDiagnosticSanitizationError(
          "RUNTIME_DIAGNOSTIC_UNSUPPORTED",
        );
      }
      addEncodedBytes(state, textEncoder.encode(String(value)).byteLength);
      return redactWholeValue ? REDACTED_VALUE : value;
    }
    if (typeof value === "boolean") {
      addEncodedBytes(state, value ? 4 : 5);
      return redactWholeValue ? REDACTED_VALUE : value;
    }
    if (value === null) {
      addEncodedBytes(state, 4);
      return redactWholeValue ? REDACTED_VALUE : null;
    }
    if (typeof value !== "object") {
      throw new RuntimeDiagnosticSanitizationError(
        "RUNTIME_DIAGNOSTIC_UNSUPPORTED",
      );
    }

    const objectValue = value as object;
    if (state.ancestors.has(objectValue)) {
      throw new RuntimeDiagnosticSanitizationError(
        "RUNTIME_DIAGNOSTIC_CYCLE",
      );
    }
    state.ancestors.add(objectValue);

    try {
      if (Array.isArray(objectValue)) {
        if (objectValue.length > RUNTIME_DIAGNOSTIC_LIMITS.maxArrayLength) {
          throw new RuntimeDiagnosticSanitizationError(
            "RUNTIME_DIAGNOSTIC_ARRAY_TOO_LARGE",
          );
        }
        const ownKeys = Reflect.ownKeys(objectValue);
        if (
          ownKeys.length !== objectValue.length + 1 ||
          !ownKeys.includes("length")
        ) {
          throw new RuntimeDiagnosticSanitizationError(
            "RUNTIME_DIAGNOSTIC_MALFORMED",
          );
        }
        addEncodedBytes(state, 2 + Math.max(0, objectValue.length - 1));
        const sanitized: RuntimeDiagnosticValue[] = [];
        for (let index = 0; index < objectValue.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(
            objectValue,
            String(index),
          );
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new RuntimeDiagnosticSanitizationError(
              "RUNTIME_DIAGNOSTIC_MALFORMED",
            );
          }
          sanitized.push(
            visit(descriptor.value, depth + 1, redactWholeValue),
          );
        }
        return redactWholeValue ? REDACTED_VALUE : sanitized;
      }

      const prototype = Object.getPrototypeOf(objectValue);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new RuntimeDiagnosticSanitizationError(
          "RUNTIME_DIAGNOSTIC_NON_PLAIN_OBJECT",
        );
      }
      const ownKeys = Reflect.ownKeys(objectValue);
      if (ownKeys.length > RUNTIME_DIAGNOSTIC_LIMITS.maxObjectKeys) {
        throw new RuntimeDiagnosticSanitizationError(
          "RUNTIME_DIAGNOSTIC_OBJECT_TOO_LARGE",
        );
      }
      addEncodedBytes(state, 2 + Math.max(0, ownKeys.length - 1));
      const sanitized: Record<string, RuntimeDiagnosticValue> = Object.create(null);
      for (const [index, key] of ownKeys.entries()) {
        if (typeof key !== "string") {
          throw new RuntimeDiagnosticSanitizationError(
            "RUNTIME_DIAGNOSTIC_MALFORMED",
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new RuntimeDiagnosticSanitizationError(
            "RUNTIME_DIAGNOSTIC_MALFORMED",
          );
        }
        addEncodedBytes(state, encodedJsonBytes(key) + 1);
        const outputKey = sanitizedObjectKey(key, index);
        sanitized[outputKey] = visit(
          descriptor.value,
          depth + 1,
          redactWholeValue || isSensitiveKey(key),
        );
      }
      return redactWholeValue ? REDACTED_VALUE : sanitized;
    } finally {
      state.ancestors.delete(objectValue);
    }
  };

  try {
    const sanitized = visit(root, 0, false);
    if (
      textEncoder.encode(JSON.stringify(sanitized)).byteLength >
      RUNTIME_DIAGNOSTIC_LIMITS.maxEncodedBytes
    ) {
      throw new RuntimeDiagnosticSanitizationError(
        "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE",
      );
    }
    return sanitized;
  } catch (error) {
    if (error instanceof RuntimeDiagnosticSanitizationError) throw error;
    throw new RuntimeDiagnosticSanitizationError(
      "RUNTIME_DIAGNOSTIC_MALFORMED",
    );
  }
};

export type RuntimeDiagnosticSafeSanitizeResult =
  | { success: true; data: RuntimeDiagnosticValue }
  | { success: false; error: RuntimeDiagnosticSanitizationError };

export const safeSanitizeRuntimeDiagnostic = (
  value: unknown,
): RuntimeDiagnosticSafeSanitizeResult => {
  try {
    return { success: true, data: sanitizeRuntimeDiagnostic(value) };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof RuntimeDiagnosticSanitizationError
          ? error
          : new RuntimeDiagnosticSanitizationError(
              "RUNTIME_DIAGNOSTIC_MALFORMED",
            ),
    };
  }
};
