import { z } from "zod";

/**
 * Structured payload that Release Integration writes to a work item's
 * `metadata.dod_human_action_v2` when it cannot auto-resolve a conflict and
 * the operator must choose between concrete options.
 *
 * Replaces the legacy free-text `metadata.dod_human_action` field. The
 * frontend renders this as a card-per-option panel with an Apply button per
 * card; the backend `/api/work-items/:id/dod-human-action/apply` endpoint
 * dispatches the action embedded in the chosen option.
 *
 * The legacy `dod_human_action` string is preserved for backwards
 * compatibility with batches authored before this split.
 */

const DOD_HUMAN_ACTION_V2_VERSION = 1;

// ──────────────────────────────────────────────
// Root cause taxonomy
// ──────────────────────────────────────────────

export const dodHumanActionRootCauseSchema = z.enum([
  // Two valid schemas for the same domain (no clear winner). Operator picks
  // which model to keep.
  "schema_irreconcilable",
  // Auto-remediation exhausted retries — escalated as a last resort.
  "auto_remediation_exhausted",
  // Catch-all for cases the agent cannot classify into a known root cause.
  "unclassified",
]);

export type DodHumanActionRootCause = z.infer<typeof dodHumanActionRootCauseSchema>;

// ──────────────────────────────────────────────
// Evidence — what the agent observed
// ──────────────────────────────────────────────

export const dodHumanActionSchemaSnapshotSchema = z.object({
  file: z.string(),
  ref: z.string().optional(),
  columns: z.array(z.string()).default([]),
});

export const dodHumanActionRelatedFeatureSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  dodApproved: z.boolean(),
  mergedAt: z.string().nullable().optional(),
});

export const dodHumanActionEvidenceSchema = z.object({
  branchSchema: dodHumanActionSchemaSnapshotSchema.optional(),
  integratedSchema: dodHumanActionSchemaSnapshotSchema.optional(),
  conflictingFiles: z.array(z.string()).default([]),
  relatedFeatures: z.array(dodHumanActionRelatedFeatureSchema).default([]),
});

// ──────────────────────────────────────────────
// Options — discriminated by action.type
// ──────────────────────────────────────────────

export const dodHumanActionRunnerFixDodActionSchema = z.object({
  type: z.literal("trigger-runner-fix-dod"),
  payload: z.object({
    integrationContext: z.record(z.string(), z.unknown()).optional(),
    /** Optional override of which leaf children to remediate. */
    leafWorkItemIds: z.array(z.string().uuid()).optional(),
  }),
});

export const dodHumanActionRunnerRevertActionSchema = z.object({
  type: z.literal("trigger-runner-revert"),
  payload: z.object({
    targetWorkItemId: z.string().uuid(),
    reason: z.string().min(1),
  }),
});

export const dodHumanActionManualActionSchema = z.object({
  type: z.literal("manual"),
  payload: z.object({
    instructions: z.string().min(1),
  }),
});

export const dodHumanActionActionSchema = z.discriminatedUnion("type", [
  dodHumanActionRunnerFixDodActionSchema,
  dodHumanActionRunnerRevertActionSchema,
  dodHumanActionManualActionSchema,
]);

export const dodHumanActionImpactSchema = z.object({
  affectedItems: z.array(z.string()).default([]),
  estimatedEffort: z.enum(["small", "medium", "large"]).optional(),
  reversible: z.boolean().optional(),
});

export const dodHumanActionOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  impact: dodHumanActionImpactSchema,
  action: dodHumanActionActionSchema,
});

// ──────────────────────────────────────────────
// Root payload
// ──────────────────────────────────────────────

export const dodHumanActionV2Schema = z.object({
  version: z.literal(DOD_HUMAN_ACTION_V2_VERSION).default(DOD_HUMAN_ACTION_V2_VERSION),
  diagnosis: z.string().min(1),
  rootCause: dodHumanActionRootCauseSchema,
  evidence: dodHumanActionEvidenceSchema,
  options: z.array(dodHumanActionOptionSchema).min(1),
  recommendation: z
    .object({
      optionId: z.string().min(1),
      reason: z.string(),
    })
    .optional(),
  /** ISO timestamp set by the agent when it stamped this payload. */
  generatedAt: z.string().optional(),
});

export type DodHumanActionV2 = z.infer<typeof dodHumanActionV2Schema>;
export type DodHumanActionOption = z.infer<typeof dodHumanActionOptionSchema>;
export type DodHumanActionImpact = z.infer<typeof dodHumanActionImpactSchema>;
export type DodHumanActionAction = z.infer<typeof dodHumanActionActionSchema>;
export type DodHumanActionEvidence = z.infer<typeof dodHumanActionEvidenceSchema>;
export type DodHumanActionRunnerFixDodAction = z.infer<typeof dodHumanActionRunnerFixDodActionSchema>;
export type DodHumanActionRunnerRevertAction = z.infer<typeof dodHumanActionRunnerRevertActionSchema>;
export type DodHumanActionManualAction = z.infer<typeof dodHumanActionManualActionSchema>;

export const DOD_HUMAN_ACTION_V2_METADATA_KEY = "dod_human_action_v2" as const;
