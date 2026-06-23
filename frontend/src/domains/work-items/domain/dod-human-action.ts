/**
 * Frontend mirror of the canonical DodHumanActionV2 shape from
 * @almirant/shared. The frontend does not import the backend package
 * directly to keep its build self-contained, so we maintain this
 * TypeScript-level mirror. Runtime validation lives on the backend.
 */

export type DodHumanActionRootCause =
  | "schema_irreconcilable"
  | "auto_remediation_exhausted"
  | "unclassified";

export interface DodHumanActionSchemaSnapshot {
  file: string;
  ref?: string;
  columns: string[];
}

export interface DodHumanActionRelatedFeature {
  taskId: string;
  title: string;
  dodApproved: boolean;
  mergedAt?: string | null;
}

export interface DodHumanActionEvidence {
  branchSchema?: DodHumanActionSchemaSnapshot;
  integratedSchema?: DodHumanActionSchemaSnapshot;
  conflictingFiles: string[];
  relatedFeatures: DodHumanActionRelatedFeature[];
}

export interface DodHumanActionImpact {
  affectedItems: string[];
  estimatedEffort?: "small" | "medium" | "large";
  reversible?: boolean;
}

export type DodHumanActionAction =
  | {
      type: "trigger-runner-fix-dod";
      payload: {
        integrationContext?: Record<string, unknown>;
        leafWorkItemIds?: string[];
      };
    }
  | {
      type: "trigger-runner-revert";
      payload: {
        targetWorkItemId: string;
        reason: string;
      };
    }
  | {
      type: "manual";
      payload: {
        instructions: string;
      };
    };

export interface DodHumanActionOption {
  id: string;
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  impact: DodHumanActionImpact;
  action: DodHumanActionAction;
}

export interface DodHumanActionV2 {
  version: 1;
  diagnosis: string;
  rootCause: DodHumanActionRootCause;
  evidence: DodHumanActionEvidence;
  options: DodHumanActionOption[];
  recommendation?: {
    optionId: string;
    reason: string;
  };
  generatedAt?: string;
}

export const DOD_HUMAN_ACTION_V2_METADATA_KEY = "dod_human_action_v2" as const;

/**
 * Type-guard for the v2 panel payload as it arrives in `metadata`.
 * The backend validates the full shape via Zod; this is the cheap
 * structural check the frontend uses to decide whether to render the
 * panel at all.
 */
export const isDodHumanActionV2 = (
  value: unknown,
): value is DodHumanActionV2 => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DodHumanActionV2>;
  return (
    typeof v.diagnosis === "string" &&
    Array.isArray(v.options) &&
    v.options.length > 0 &&
    !!v.evidence
  );
};
