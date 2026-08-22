import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeAgentModel } from "./model-capabilities";

export type PlanReviewProvider = "anthropic" | "openai" | "google" | "zai" | "xai";
export type PlanReviewRuntime = "opencode" | "claude-code" | "codex";
export type PlanReviewOutcome = "accept" | "revise" | "reject" | "skipped_unavailable" | "not_completed";
export type PlanReviewResolutionStatus = "ready" | "degraded" | "skipped";
export type PlanReviewDegradationStatus =
  | "none"
  | "same_model_isolated"
  | "fewer_critics"
  | "skipped_unavailable";

export interface PlanReviewPolicy {
  enabled: boolean;
  requestedCriticCount?: 2 | 3 | 4;
}

export type PlanReviewWorkItemType = "epic" | "feature" | "story" | "task";

export interface PlanReviewPlanItem {
  tempId: string;
  type: PlanReviewWorkItemType;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  parentTempId?: string;
}

export interface PlanReviewPlanDependency {
  blockedTempId: string;
  blockedByTempId: string;
}

export interface PlanReviewStructuredPlan {
  items: PlanReviewPlanItem[];
  dependencies: PlanReviewPlanDependency[];
  projectId: string;
  boardId: string;
  boardColumnId: string;
}

export interface PlanReviewFrozenPlan {
  revisionId: string;
  sha256: string;
  /** Canonical JSON bytes, never a free-form prompt or provider configuration. */
  content: string;
}

export interface PlanReviewCriticSnapshot {
  /** Opaque audit handle, not a bearer credential and not an authorization token. */
  correlationRef: string;
  provider: PlanReviewProvider;
  model: string;
  runtime: PlanReviewRuntime;
  isolated: boolean;
}

export interface PlanReviewResolution {
  status: PlanReviewResolutionStatus;
  degradation: {
    status: PlanReviewDegradationStatus;
    reason: string;
  };
}

export interface PlanReviewJobSnapshotV2 {
  version: 2;
  intent: "plan-review";
  reviewJobId: string;
  enabled: true;
  originalPlan: PlanReviewFrozenPlan;
  requestedCriticCount: 2 | 3 | 4;
  maxRevisions: 1;
  critics: PlanReviewCriticSnapshot[];
  resolution: PlanReviewResolution;
}

/** Persisted legacy shape. It is accepted only so old jobs can be skipped safely. */
export type PlanReviewLegacyJobConfig = { version: 1; enabled?: boolean } & Record<string, unknown>;

export type PlanReviewJobConfig = PlanReviewJobSnapshotV2 | PlanReviewLegacyJobConfig;

export interface PlanReviewCapabilityCandidate {
  provider: PlanReviewProvider;
  model: string;
  runtime: PlanReviewRuntime;
  supportsIndependentCritics: boolean;
  maxIndependentCritics: number;
}

export interface PlanReviewFinding {
  findingId: string;
  criticRef: string;
  lens:
    | "architecture_dependencies"
    | "reliability_tests_dod"
    | "risk_migration_rollback"
    | "scope_sequencing_overengineering";
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string;
  requirementEvidence: string[];
  taskEvidence: string[];
  recommendation: string;
}

export interface PlanReviewFindingDecision {
  findingId: string;
  decision: "accept" | "refute";
  evidence: string;
}

export interface PlanReviewOutput {
  outputVersion: 1;
  intent: "plan-review";
  reviewJobId: string;
  originalPlanSha256: string;
  finalPlan: PlanReviewFrozenPlan;
  findings: PlanReviewFinding[];
  findingDecisions: PlanReviewFindingDecision[];
  outcome: PlanReviewOutcome;
  rationale: string;
  revisionCount: 0 | 1;
}

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase());

/** RFC 8785-style key ordering for the JSON-compatible values used here. */
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Value is not canonical JSON");
};

// Free-form plan evidence is rejected rather than partially redacted. The
// detector is intentionally conservative at the serialization boundary.
const SENSITIVE_KEY_PATTERN = String.raw`(?:authorization|proxy[\s_-]*authorization|x[\s_-]*api[\s_-]*key|x[\s_-]*auth[\s_-]*token|cookie|api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|private[\s_-]*key|mcp[\s_-]*(?:connection|endpoint|server|url)|provider[\s_-]*(?:connection|endpoint|server|url)|connection(?:[\s_-]*(?:details?|info|metadata|url|endpoint|configuration))?|credentials?|password|token|secret)`;
const SENSITIVE_KEY_VALUE_PATTERN = new RegExp(
  String.raw`(?:^|[^\w]["']?)${SENSITIVE_KEY_PATTERN}["']?\s*(?:[:=]|=>|->)\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,}\]]+)`,
  "i",
);
const SENSITIVE_WHITESPACE_MARKER_PATTERN =
  /(?:^|[^\w])(?:token|secret|credentials?|password)\s+(?:[A-Za-z0-9][A-Za-z0-9._-]*[-_](?:value|token|secret|key)|bearer\b|jwt\b|oauth\b|[A-F0-9]{16,})(?=$|[\s,.;)}\]])/i;
const CONNECTION_MARKER_PATTERN = new RegExp(
  String.raw`(?:^|[^\w])(?:(?:(?:provider|mcp)\s+(?:connection|server|endpoint|url))|connection)(?:\s+(?:details?|info|metadata|url|endpoint|configuration))?\s*(?:(?::|=|=>|->)\s*|\s+)["']?(?:https?|wss?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"']+`,
  "i",
);
const SENSITIVE_PLAN_PATTERNS: RegExp[] = [
  SENSITIVE_KEY_VALUE_PATTERN,
  SENSITIVE_WHITESPACE_MARKER_PATTERN,
  CONNECTION_MARKER_PATTERN,
  /(?:^|\n)\s*(?:export\s+)?[A-Z][A-Z0-9_]{1,}\s*=\s*\S+/m,
  /\b(?:authorization|proxy-authorization|x-api-key|x-auth-token|cookie)\s*:\s*\S+/i,
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|secret[-_]?key|password|credentials?|private[-_]?key)\s*[:=]\s*["']?\S+/i,
  /\b(?:mcp|provider|connection)[A-Za-z0-9_-]*(?:endpoint|url|connection|details|id)?\s*[:=]\s*["']?(?:https?|wss?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?)\:\/\//i,
  /\b(?:https?|wss?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s]*[?&](?:token|api[-_]?key|access[-_]?token|secret|password)=/i,
  /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp|ssh):\/\/[^\s/@]+:[^\s@]+@/i,
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{3,}|gh[pso]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|xox[bpsar]-[A-Za-z0-9-]{6,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/i,
];

export const containsSensitivePlanContent = (content: string): boolean =>
  SENSITIVE_PLAN_PATTERNS.some((pattern) => pattern.test(content));

const safeFreeText = (maxLength: number, message: string) =>
  z.string().max(maxLength).refine((value) => !containsSensitivePlanContent(value), message);

const frozenPlanSchema = z.object({
  revisionId: identifier,
  sha256,
  content: safeFreeText(200_000, "Plan contains sensitive or connection material."),
}).strict();

const planItemSchema = z.object({
  tempId: z.string().min(1).max(200),
  type: z.enum(["epic", "feature", "story", "task"]),
  title: safeFreeText(500, "Plan item contains sensitive or connection material."),
  description: safeFreeText(20_000, "Plan item contains sensitive or connection material.").optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  parentTempId: z.string().min(1).max(200).optional(),
}).strict();

const structuredPlanSchema = z.object({
  items: z.array(planItemSchema).min(1).max(500),
  dependencies: z.array(z.object({
    blockedTempId: z.string().min(1).max(200),
    blockedByTempId: z.string().min(1).max(200),
  }).strict()).max(1_000),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  boardColumnId: z.string().min(1),
}).strict().superRefine((plan, context) => {
  const seen = new Set<string>();
  for (const [index, item] of plan.items.entries()) {
    if (seen.has(item.tempId)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "tempId"],
        message: "Each plan item must have a unique tempId.",
      });
    }
    seen.add(item.tempId);
  }

  const itemIndexByTempId = new Map(plan.items.map((item, index) => [item.tempId, index]));
  for (const [index, item] of plan.items.entries()) {
    if (!item.parentTempId) continue;
    const parentIndex = itemIndexByTempId.get(item.parentTempId);
    if (parentIndex === undefined) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "parentTempId"],
        message: `Parent tempId "${item.parentTempId}" must reference an item in the same plan.`,
      });
      continue;
    }
    if (item.parentTempId === item.tempId) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "parentTempId"],
        message: "An item cannot be its own parent.",
      });
    }
  }

  for (const [index, item] of plan.items.entries()) {
    const visited = new Set<string>();
    let current: typeof item | undefined = item;
    while (current?.parentTempId) {
      if (visited.has(current.tempId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "parentTempId"],
          message: "Parent references cannot contain cycles.",
        });
        break;
      }
      visited.add(current.tempId);
      const parentIndex = itemIndexByTempId.get(current.parentTempId);
      if (parentIndex === undefined) break;
      current = plan.items[parentIndex];
    }
  }
});

export const planReviewPolicySchema = z.union([
  z.object({
    enabled: z.literal(false),
    requestedCriticCount: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  }).strict(),
  z.object({
    enabled: z.literal(true),
    requestedCriticCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  }).strict(),
]);

const criticSnapshotSchema = z.object({
  correlationRef: z.string().regex(/^prc1\.[A-Za-z0-9_-]{43}$/),
  provider: z.enum(["anthropic", "openai", "google", "zai", "xai"]),
  model: identifier,
  runtime: z.enum(["opencode", "claude-code", "codex"]),
  isolated: z.boolean(),
}).strict();

const resolutionSchema = z.object({
  status: z.enum(["ready", "degraded", "skipped"]),
  degradation: z.object({
    status: z.enum(["none", "same_model_isolated", "fewer_critics", "skipped_unavailable"]),
    reason: safeFreeText(500, "Plan review resolution contains sensitive material."),
  }).strict(),
}).strict();

export const planReviewJobSnapshotSchema = z.object({
  version: z.literal(2),
  intent: z.literal("plan-review"),
  reviewJobId: identifier,
  enabled: z.literal(true),
  originalPlan: frozenPlanSchema,
  requestedCriticCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  maxRevisions: z.literal(1),
  critics: z.array(criticSnapshotSchema).max(4),
  resolution: resolutionSchema,
}).strict().superRefine((snapshot, context) => {
  if (snapshot.resolution.status === "skipped" && snapshot.critics.length > 0) {
    context.addIssue({ code: "custom", path: ["critics"], message: "Skipped review cannot carry executable critics." });
  }
});

const findingSchema = z.object({
  findingId: identifier,
  criticRef: z.string().regex(/^prc1\.[A-Za-z0-9_-]{43}$/),
  lens: z.enum([
    "architecture_dependencies",
    "reliability_tests_dod",
    "risk_migration_rollback",
    "scope_sequencing_overengineering",
  ]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  summary: safeFreeText(10_000, "Finding contains sensitive material."),
  requirementEvidence: z.array(safeFreeText(5_000, "Finding evidence contains sensitive material.")).max(20),
  taskEvidence: z.array(safeFreeText(5_000, "Finding evidence contains sensitive material.")).max(20),
  recommendation: safeFreeText(10_000, "Finding contains sensitive material."),
}).strict();

const findingDecisionSchema = z.object({
  findingId: identifier,
  decision: z.enum(["accept", "refute"]),
  evidence: safeFreeText(10_000, "Finding decision contains sensitive material."),
}).strict();

const planReviewOutputSchema = z.object({
  outputVersion: z.literal(1),
  intent: z.literal("plan-review"),
  reviewJobId: identifier,
  originalPlanSha256: sha256,
  finalPlan: frozenPlanSchema,
  findings: z.array(findingSchema).max(100),
  findingDecisions: z.array(findingDecisionSchema).max(100),
  outcome: z.enum(["accept", "revise", "reject", "skipped_unavailable", "not_completed"]),
  rationale: safeFreeText(20_000, "Plan review rationale contains sensitive material."),
  revisionCount: z.union([z.literal(0), z.literal(1)]),
}).strict();

export const hashPlanReviewContent = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export const canonicalizePlanReviewPlan = (plan: PlanReviewStructuredPlan): PlanReviewFrozenPlan => {
  const parsed = structuredPlanSchema.parse(plan);
  const content = canonicalJson(parsed);
  if (containsSensitivePlanContent(content)) {
    throw new Error("Plan contains sensitive or connection material.");
  }
  return { revisionId: "original", content, sha256: hashPlanReviewContent(content) };
};

/** Opaque audit handle only. Authorization is completed server-side before persistence. */
export const createPlanReviewOpaqueReference = (input: {
  workspaceId: string;
  userId: string;
  reviewJobId: string;
  provider: PlanReviewProvider;
  model: string;
  runtime: PlanReviewRuntime;
  criticIndex?: number;
}): string => {
  const digest = createHash("sha256")
    .update(canonicalJson(input), "utf8")
    .digest("base64url");
  return `prc1.${digest}`;
};

const runtimeForProvider = (provider: PlanReviewProvider): PlanReviewRuntime => {
  if (provider === "anthropic") return "claude-code";
  if (provider === "openai") return "codex";
  return "opencode";
};

export const resolvePlanReviewCritics = (input: {
  workspaceId: string;
  userId: string;
  reviewJobId: string;
  requestedCriticCount: 2 | 3 | 4;
  candidates: PlanReviewCapabilityCandidate[];
}): { critics: PlanReviewCriticSnapshot[]; resolution: PlanReviewResolution } => {
  const candidates = input.candidates
    .map((candidate) => ({
      ...candidate,
      model: normalizeAgentModel(candidate.provider, candidate.model) ?? candidate.model,
      runtime: candidate.runtime || runtimeForProvider(candidate.provider),
      maxIndependentCritics: Math.max(0, Math.min(4, Math.floor(candidate.maxIndependentCritics))),
    }));

  if (candidates.length === 0) {
    return {
      critics: [],
      resolution: {
        status: "skipped",
        degradation: { status: "skipped_unavailable", reason: "No active authorized AI connection has an entitled model." },
      },
    };
  }

  const executable = candidates.filter((candidate) =>
    candidate.supportsIndependentCritics && candidate.maxIndependentCritics > 0,
  );
  if (executable.length === 0) {
    return {
      critics: [],
      resolution: {
        status: "skipped",
        degradation: { status: "skipped_unavailable", reason: "The current runner has no executable independent critic fan-out." },
      },
    };
  }

  const selected: PlanReviewCriticSnapshot[] = [];
  const counts = new Map<string, number>();
  for (let pass = 0; pass < 4 && selected.length < input.requestedCriticCount; pass += 1) {
    for (const candidate of executable) {
      const key = `${candidate.provider}/${candidate.model}/${candidate.runtime}`;
      const limit = candidate.maxIndependentCritics;
      const current = counts.get(key) ?? 0;
      if (current >= limit || current > pass || selected.length >= input.requestedCriticCount) continue;
      selected.push({
        correlationRef: createPlanReviewOpaqueReference({
          workspaceId: input.workspaceId,
          userId: input.userId,
          reviewJobId: input.reviewJobId,
          provider: candidate.provider,
          model: candidate.model,
          runtime: candidate.runtime,
          criticIndex: selected.length,
        }),
        provider: candidate.provider,
        model: candidate.model,
        runtime: candidate.runtime,
        isolated: false,
      });
      counts.set(key, current + 1);
    }
  }

  if (selected.length < input.requestedCriticCount) {
    return {
      critics: selected,
      resolution: {
        status: "degraded",
        degradation: {
          status: selected.length === 0 ? "skipped_unavailable" : "fewer_critics",
          reason: selected.length === 0
            ? "No authorized candidate supports the requested critic semantics."
            : `Only ${selected.length} of ${input.requestedCriticCount} authorized critics are executable.`,
        },
      },
    };
  }

  const modelKeys = new Set(selected.map((critic) => `${critic.provider}/${critic.model}/${critic.runtime}`));
  const sameModel = modelKeys.size === 1;
  return {
    critics: selected.map((critic) => ({ ...critic, isolated: sameModel })),
    resolution: {
      status: sameModel ? "degraded" : "ready",
      degradation: {
        status: sameModel ? "same_model_isolated" : "none",
        reason: sameModel ? "Only one authorized model is executable; critics are isolated." : "Heterogeneous authorized critics are executable.",
      },
    },
  };
};

export const buildSkippedPlanReviewResult = (
  reviewJobId: string,
  snapshot: PlanReviewJobSnapshotV2,
  reason: string,
): PlanReviewOutput => ({
  outputVersion: 1,
  intent: "plan-review",
  reviewJobId,
  originalPlanSha256: snapshot.originalPlan.sha256,
  finalPlan: snapshot.originalPlan,
  findings: [],
  findingDecisions: [],
  outcome: "skipped_unavailable",
  rationale: reason,
  revisionCount: 0,
});

const parsePlanReviewJson = (value: string): unknown => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? trimmed;
  try {
    return JSON.parse(fenced);
  } catch {
    return null;
  }
};

export const extractPlanReviewOutput = (result: unknown): unknown => {
  if (typeof result === "string") return parsePlanReviewJson(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;

  const record = result as Record<string, unknown>;
  for (const key of ["planReviewOutput", "output", "planReview"]) {
    if (record[key] !== undefined) return record[key];
  }
  if (typeof record.summary === "string") return parsePlanReviewJson(record.summary);
  return null;
};

export const sanitizePlanReviewJobResult = (
  result: unknown,
  snapshot: PlanReviewJobSnapshotV2,
): { storedResult: Record<string, unknown>; output: PlanReviewOutput | null } => {
  if (snapshot.resolution.status === "skipped") {
    const output = buildSkippedPlanReviewResult(
      snapshot.reviewJobId,
      snapshot,
      snapshot.resolution.degradation.reason,
    );
    return { storedResult: { planReviewOutput: output }, output };
  }

  try {
    const output = validatePlanReviewOutput(extractPlanReviewOutput(result), snapshot);
    return { storedResult: { planReviewOutput: output }, output };
  } catch {
    return {
      storedResult: {
        planReviewOutput: null,
        error: "plan_review_output_invalid",
      },
      output: null,
    };
  }
};

/** Strict, non-sensitive envelope used when a persisted snapshot is invalid. */
export const buildInvalidPlanReviewStoredResult = (): Record<string, unknown> => ({
  planReviewOutput: null,
  outcome: "not_completed",
  error: "plan_review_snapshot_invalid",
});

export const validatePlanReviewOutput = (
  output: unknown,
  snapshot: PlanReviewJobSnapshotV2,
): PlanReviewOutput => {
  const parsed = planReviewOutputSchema.parse(output);
  if (parsed.reviewJobId !== snapshot.reviewJobId) throw new Error("Plan review output job binding mismatch.");
  if (parsed.originalPlanSha256 !== snapshot.originalPlan.sha256) throw new Error("Plan review output original digest mismatch.");
  if (hashPlanReviewContent(parsed.finalPlan.content) !== parsed.finalPlan.sha256) throw new Error("Plan review output final digest mismatch.");
  try {
    const structuredFinalPlan = structuredPlanSchema.parse(JSON.parse(parsed.finalPlan.content));
    if (canonicalJson(structuredFinalPlan) !== parsed.finalPlan.content) {
      throw new Error("Plan review output final plan is not canonical JSON.");
    }

    const originalPlan = structuredPlanSchema.parse(JSON.parse(snapshot.originalPlan.content));
    for (const target of ["projectId", "boardId", "boardColumnId"] as const) {
      if (structuredFinalPlan[target] !== originalPlan[target]) {
        throw new Error(`Plan review output final plan ${target} does not match the original target.`);
      }
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Plan review output final plan is invalid.");
  }
  const finalIsOriginal = parsed.finalPlan.sha256 === snapshot.originalPlan.sha256;
  if (parsed.revisionCount !== (finalIsOriginal ? 0 : 1)) throw new Error("Plan review output revision count mismatch.");
  if ((parsed.outcome === "reject" || parsed.outcome === "not_completed" || parsed.outcome === "skipped_unavailable") && !finalIsOriginal) {
    throw new Error("Rejected or incomplete plan review output cannot revise the plan.");
  }

  const criticRefs = new Set(snapshot.critics.map((critic) => critic.correlationRef));
  const findingIds = new Set<string>();
  for (const finding of parsed.findings) {
    if (!criticRefs.has(finding.criticRef)) throw new Error("Plan review finding references an unauthorized critic.");
    if (findingIds.has(finding.findingId)) throw new Error("Plan review output contains duplicate findings.");
    findingIds.add(finding.findingId);
  }
  if (parsed.findingDecisions.length !== parsed.findings.length) throw new Error("Every plan review finding requires exactly one decision.");
  const decisionIds = new Set(parsed.findingDecisions.map((decision) => decision.findingId));
  if (decisionIds.size !== parsed.findingDecisions.length || [...findingIds].some((id) => !decisionIds.has(id))) {
    throw new Error("Plan review finding decisions do not match findings.");
  }
  return parsed;
};

export type PlanReviewRunnerNormalization =
  | { status: "ready"; snapshot: PlanReviewJobSnapshotV2 }
  | { status: "skipped_unavailable"; reason: string };

const isRunnerExecutableOriginalPlan = (originalPlan: PlanReviewFrozenPlan): boolean => {
  if (originalPlan.revisionId !== "original") return false;
  try {
    const canonicalPlan = canonicalizePlanReviewPlan(JSON.parse(originalPlan.content) as PlanReviewStructuredPlan);
    return canonicalPlan.content === originalPlan.content && canonicalPlan.sha256 === originalPlan.sha256;
  } catch {
    return false;
  }
};

export const normalizePlanReviewSnapshotForRunner = (input: unknown): PlanReviewRunnerNormalization => {
  const parsed = planReviewJobSnapshotSchema.safeParse(input);
  if (!parsed.success || !isRunnerExecutableOriginalPlan(parsed.data.originalPlan)) {
    return { status: "skipped_unavailable", reason: "legacy_or_invalid_plan_review_snapshot" };
  }
  if (parsed.data.resolution.status === "skipped") {
    return { status: "skipped_unavailable", reason: parsed.data.resolution.degradation.reason };
  }
  return { status: "ready", snapshot: parsed.data };
};
