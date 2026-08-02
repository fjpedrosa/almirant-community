import { createHash } from "node:crypto";
import {
  encryptCredentials,
  type AgentOutputPolicySnapshot,
  type AgentOutputSinkDb,
} from "@almirant/database";
import { canonicalAgentOutputJson } from "./agent-output-capability";

export class AgentOutputBindingValidationError extends Error {}

const PLACEHOLDER = /\{\{binding\.([A-Za-z0-9_.-]+)\}\}/g;
const FORBIDDEN_LEGACY_METADATA_KEYS = new Set([
  "callbackurl",
  "deliveryheaders",
  "deliveryurl",
  "outputbinding",
  "webhookurl",
]);
const MAX_BINDING_KEYS = 32;
const MAX_BINDING_VALUE_BYTES = 4096;
const MAX_BINDING_BYTES = 32 * 1024;

/**
 * Fail closed for the legacy callback contract before metadata sanitization.
 *
 * These fields carried delivery secrets in ordinary prompt metadata. We do
 * not parse or migrate them heuristically: callers must use outputBinding.
 */
export const assertNoLegacyOutputDeliveryMetadata = (
  metadata: unknown,
): void => {
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8) return;
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_LEGACY_METADATA_KEYS.has(normalizedKey)) {
        throw new AgentOutputBindingValidationError(
          "Legacy output delivery metadata is not accepted",
        );
      }
      visit(entry, depth + 1);
    }
  };
  visit(metadata, 0);
};

const placeholderKeys = (
  sink: Pick<AgentOutputSinkDb, "pathTemplate" | "headerTemplates">,
): Set<string> => {
  const keys = new Set<string>();
  const templates = [
    sink.pathTemplate,
    ...Object.values(sink.headerTemplates),
  ];
  for (const template of templates) {
    for (const match of template.matchAll(PLACEHOLDER)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
  return keys;
};

const validateBinding = (
  rawBinding: unknown,
  sink: Pick<AgentOutputSinkDb, "pathTemplate" | "headerTemplates">,
): Record<string, string> | null => {
  const requiredKeys = placeholderKeys(sink);
  if (rawBinding === undefined || rawBinding === null) {
    if (requiredKeys.size > 0) {
      throw new AgentOutputBindingValidationError(
        "This output sink requires an output binding",
      );
    }
    return null;
  }
  if (
    typeof rawBinding !== "object" ||
    Array.isArray(rawBinding)
  ) {
    throw new AgentOutputBindingValidationError(
      "Output binding must be an object",
    );
  }

  const entries = Object.entries(rawBinding as Record<string, unknown>);
  if (entries.length > MAX_BINDING_KEYS) {
    throw new AgentOutputBindingValidationError(
      "Output binding has too many values",
    );
  }
  const actualKeys = new Set(entries.map(([key]) => key));
  if (
    actualKeys.size !== requiredKeys.size ||
    [...requiredKeys].some((key) => !actualKeys.has(key))
  ) {
    throw new AgentOutputBindingValidationError(
      "Output binding does not match the pinned sink template",
    );
  }

  const binding: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      Buffer.byteLength(value, "utf8") > MAX_BINDING_VALUE_BYTES ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new AgentOutputBindingValidationError(
        `Output binding value "${key}" is invalid`,
      );
    }
    binding[key] = value;
  }
  if (
    Buffer.byteLength(canonicalAgentOutputJson(binding), "utf8") >
    MAX_BINDING_BYTES
  ) {
    throw new AgentOutputBindingValidationError(
      "Output binding exceeds the byte limit",
    );
  }
  return binding;
};

export const buildOutputPolicySnapshot = (policy: {
  required: boolean;
  sink: AgentOutputSinkDb;
}): AgentOutputPolicySnapshot => {
  const snapshot: AgentOutputPolicySnapshot = {
    sinkId: policy.sink.id,
    sinkVersion: policy.sink.version,
    required: policy.required,
    schemaHash: policy.sink.schemaHash,
    schema: policy.sink.payloadSchema,
    maxPayloadBytes: policy.sink.maxPayloadBytes,
  };
  if (
    hashJson(snapshot.schema) !== snapshot.schemaHash ||
    !Number.isSafeInteger(snapshot.sinkVersion) ||
    snapshot.sinkVersion <= 0 ||
    !Number.isSafeInteger(snapshot.maxPayloadBytes) ||
    snapshot.maxPayloadBytes <= 0 ||
    snapshot.maxPayloadBytes > 1024 * 1024
  ) {
    throw new AgentOutputBindingValidationError(
      "Pinned output sink policy is invalid",
    );
  }
  return snapshot;
};

const hashJson = (value: unknown): string =>
  createHash("sha256")
    .update(canonicalAgentOutputJson(value))
    .digest("hex");

export const prepareEncryptedOutputBinding = (input: {
  rawBinding: unknown;
  sink: AgentOutputSinkDb;
  encryptionKey: string | undefined;
}):
  | null
  | {
      encryptedBinding: string;
      bindingIv: string;
      bindingAuthTag: string;
      bindingHash: string;
      keyVersion: 1;
    } => {
  const binding = validateBinding(input.rawBinding, input.sink);
  if (!binding) return null;
  if (!input.encryptionKey) {
    throw new AgentOutputBindingValidationError(
      "Output binding encryption is not configured",
    );
  }
  const encrypted = encryptCredentials(binding, input.encryptionKey);
  return {
    encryptedBinding: encrypted.encryptedCredentials,
    bindingIv: encrypted.credentialsIv,
    bindingAuthTag: encrypted.credentialsAuthTag,
    bindingHash: hashJson(binding),
    keyVersion: 1,
  };
};
