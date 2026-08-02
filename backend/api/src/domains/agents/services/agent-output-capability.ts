import { createHash } from "node:crypto";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import type { AgentOutputPolicySnapshot } from "@almirant/database";

export interface AgentOutputCapabilityActor {
  jobId?: string;
  workspaceId?: string;
  permissions: string[];
  sessionType?: string;
}

export interface AgentOutputCapabilityRecord {
  job: {
    id: string;
    workspaceId: string | null;
    status: string;
    config: {
      scheduledConfigId?: string;
      outputPolicy?: AgentOutputPolicySnapshot;
    };
  };
  run: {
    id: string;
    agentJobId: string | null;
    workspaceId: string;
  };
  sink: {
    id: string;
    workspaceId: string;
    version: number;
    enabled: boolean;
  };
  submission: { id: string; payloadHash?: string | null } | null;
}

export interface PersistAgentOutputInput {
  runId: string;
  jobId: string;
  sinkId: string;
  payload: unknown;
  canonicalPayload: string;
  payloadHash: string;
  submittedAt: Date;
}

interface AgentOutputCapabilityDependencies {
  findByJobId(jobId: string): Promise<AgentOutputCapabilityRecord | null>;
  submit(input: PersistAgentOutputInput): Promise<{
    submissionId: string;
    replay: boolean;
  }>;
  now?: () => Date;
}

export class AgentOutputCapabilityDeniedError extends Error {
  // Without this the log line reads `errorName: "Error"` and a denial is
  // indistinguishable from a schema violation.
  override readonly name = "AgentOutputCapabilityDeniedError";
}

/**
 * Carries the schema violations that produced it. The agent already holds the
 * snapshotted schema in its prompt and authored the payload, so naming the
 * offending path and rule tells it nothing it did not supply — but withholding
 * it makes the failure unfixable: a blocked store leaves optional fields
 * without evidence, an agent that refuses to invent data sends null, and a bare
 * rejection sends it retrying the same shape instead of using `[]`/`{}`.
 */
export class AgentOutputValidationError extends Error {
  override readonly name = "AgentOutputValidationError";
  details?: string[];
}

const MAX_VALIDATION_DETAILS = 5;
const MAX_VALIDATION_DETAIL_CHARS = 200;

/**
 * Formats Ajv errors as `path: keyword message`. Deliberately drops `params`
 * and any `data`, so no payload value can ride along.
 */
const describeSchemaViolations = (
  errors: ValidateFunction["errors"],
): string[] =>
  (errors ?? []).slice(0, MAX_VALIDATION_DETAILS).map((error) =>
    `${error.instancePath || "/"}: ${error.keyword} ${error.message ?? ""}`
      .trim()
      .slice(0, MAX_VALIDATION_DETAIL_CHARS),
  );

const canonicalize = (
  value: unknown,
  ancestors: Set<object>,
): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AgentOutputValidationError(
        "Structured output must contain finite JSON numbers",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new AgentOutputValidationError(
      "Structured output must be valid JSON",
    );
  }
  if (ancestors.has(value)) {
    throw new AgentOutputValidationError(
      "Structured output must not contain cycles",
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry, ancestors));
    }
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
};

export const canonicalAgentOutputJson = (value: unknown): string => {
  const encoded = JSON.stringify(canonicalize(value, new Set()));
  if (encoded === undefined) {
    throw new AgentOutputValidationError(
      "Structured output must be valid JSON",
    );
  }
  return encoded;
};

export const hashCanonicalAgentOutput = (value: unknown): string =>
  createHash("sha256").update(canonicalAgentOutputJson(value)).digest("hex");

const assertBoundActor = (
  actor: AgentOutputCapabilityActor,
  record: AgentOutputCapabilityRecord,
): AgentOutputPolicySnapshot => {
  const policy = record.job.config.outputPolicy;
  if (
    !actor.permissions.includes("mcp:write") ||
    actor.sessionType !== "agent" ||
    !actor.jobId ||
    !actor.workspaceId ||
    actor.jobId !== record.job.id ||
    actor.workspaceId !== record.job.workspaceId ||
    record.run.agentJobId !== record.job.id ||
    record.run.workspaceId !== actor.workspaceId ||
    !policy ||
    policy.sinkId !== record.sink.id ||
    policy.sinkVersion !== record.sink.version ||
    record.sink.workspaceId !== actor.workspaceId ||
    !record.sink.enabled ||
    !["queued", "running"].includes(record.job.status)
  ) {
    throw new AgentOutputCapabilityDeniedError(
      "Agent output capability denied",
    );
  }
  if (
    !Number.isSafeInteger(policy.maxPayloadBytes) ||
    policy.maxPayloadBytes <= 0 ||
    policy.maxPayloadBytes > 1024 * 1024 ||
    !Number.isSafeInteger(policy.sinkVersion) ||
    policy.sinkVersion <= 0 ||
    hashCanonicalAgentOutput(policy.schema) !== policy.schemaHash
  ) {
    throw new AgentOutputCapabilityDeniedError(
      "Agent output policy snapshot is invalid",
    );
  }
  return policy;
};

/**
 * Agents routinely stringify the object before handing it to an MCP tool, and
 * the tool input is `unknown`, so the JSON arrives as a string and the schema
 * rejects it with a root type error. Retry once with the parsed value — only
 * after the raw value has already failed, so a schema that legitimately accepts
 * a string keeps receiving the string it was given.
 */
const reparseSerializedObject = (value: unknown): unknown => {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const validatePayload = (
  value: unknown,
  policy: AgentOutputPolicySnapshot,
): { canonicalPayload: string; payloadHash: string; payload: unknown } => {
  let validator: ValidateFunction;
  try {
    validator = outputSchemaValidators.get(policy.schemaHash) ??
      outputSchemaCompiler.compile(policy.schema);
    outputSchemaValidators.set(policy.schemaHash, validator);
  } catch {
    throw new AgentOutputValidationError(
      "Structured output schema is invalid",
    );
  }
  let candidate = value;
  if (!validator(candidate)) {
    const violations = describeSchemaViolations(validator.errors);
    const reparsed = reparseSerializedObject(value);
    if (reparsed === undefined || !validator(reparsed)) {
      const violation = new AgentOutputValidationError(
        "Structured output violates the snapshotted schema",
      );
      // Report the failure of the value as sent, not of the retry.
      violation.details = violations;
      throw violation;
    }
    candidate = reparsed;
  }
  const canonicalPayload = canonicalAgentOutputJson(candidate);
  if (Buffer.byteLength(canonicalPayload, "utf8") > policy.maxPayloadBytes) {
    throw new AgentOutputValidationError(
      "Structured output exceeds the snapshotted byte limit",
    );
  }
  return {
    canonicalPayload,
    payload: candidate,
    payloadHash: createHash("sha256")
      .update(canonicalPayload)
      .digest("hex"),
  };
};

const outputSchemaCompiler = new Ajv2020({
  allErrors: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
});
const outputSchemaValidators = new Map<string, ValidateFunction>();

export const createAgentOutputCapabilityService = (
  dependencies: AgentOutputCapabilityDependencies,
) => ({
  submit: async (actor: AgentOutputCapabilityActor, value: unknown) => {
    if (!actor.jobId) {
      throw new AgentOutputCapabilityDeniedError("Missing job capability");
    }
    const record = await dependencies.findByJobId(actor.jobId);
    if (!record) {
      throw new AgentOutputCapabilityDeniedError("Unknown job capability");
    }
    const policy = assertBoundActor(actor, record);
    const { canonicalPayload, payload, payloadHash } = validatePayload(
      value,
      policy,
    );
    const submitted = await dependencies.submit({
      runId: record.run.id,
      jobId: record.job.id,
      sinkId: record.sink.id,
      // The validated value, so a stringified submission persists and hashes
      // identically to the same object sent directly.
      payload,
      canonicalPayload,
      payloadHash,
      submittedAt: dependencies.now?.() ?? new Date(),
    });
    return {
      submissionId: submitted.submissionId,
      status: "submitted" as const,
      replay: submitted.replay,
    };
  },
});

export type AgentOutputCapabilityService = ReturnType<
  typeof createAgentOutputCapabilityService
>;
