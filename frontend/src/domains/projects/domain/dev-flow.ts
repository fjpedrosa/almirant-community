import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "./dev-flow-automation-overrides";
import type {
  ProjectDevFlowAutomationRow,
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowDiagnosisState,
} from "./types";

// Re-exported for callers (hooks/containers/tests) that only need the
// diagnosis-state shape without pulling in the rest of domain/types.ts.
export type DevFlowDiagnosisState = ProjectDevFlowDiagnosisState;

const IDLE_DIAGNOSIS: ProjectDevFlowDiagnosisState = {
  status: "idle",
  result: null,
  error: null,
};

/**
 * Maps GET /projects/:id/dev-flow's `automations` array onto the
 * presentational row shape, attaching the lazy per-row `/explain` diagnosis
 * (keyed by the automation's scheduled-agent `configId`).
 *
 * The backend is now the single source of truth for `name`/`description`
 * (each automation entry already carries its catalog label) and for
 * ordering (always exactly 4 entries, in catalog order) — this function no
 * longer joins against a local `BUILTIN_AUTOMATIONS` copy the way it did
 * against the provisional contract. If the backend ever needs a client-side
 * fallback catalog again (e.g. to render something before the first
 * response arrives), reintroduce it here rather than upstream in the hook.
 *
 * Rows without a provisioned `configId` (not yet provisioned) can never have
 * a diagnosis, so they always render as idle regardless of the map's
 * contents.
 *
 * The row's `override`/`hasChanges`/`isSaving`/`isAdopting` fields start at
 * their server-baseline values (server `overrides` or fully-inherited,
 * `false`, `false`, `false`) — the container overlays any unsaved local
 * draft and in-flight mutation state on top via
 * `applyDevFlowAutomationDrafts` (see dev-flow-automation-overrides.ts).
 */
export const mergeDevFlowAutomations = (
  automations: ProjectDevFlowAutomationStatus[],
  diagnosisByConfigId: Record<string, ProjectDevFlowDiagnosisState>,
): ProjectDevFlowAutomationRow[] =>
  automations.map((automation) => ({
    automationId: automation.automationId,
    name: automation.name,
    description: automation.description,
    configId: automation.configId,
    enabled: automation.enabled,
    lastRunAt: automation.lastRunAt,
    isSkippedForUserAgent: automation.skippedForExistingUserAgent,
    diagnosis:
      (automation.configId && diagnosisByConfigId[automation.configId]) || IDLE_DIAGNOSIS,
    effective: automation.effective,
    override: automation.overrides ?? EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  }));

/**
 * Parses the "max concurrent jobs" text input into either a positive integer
 * or `null` (meaning "no override — inherit the runtime default"). Rejects
 * zero, negative, non-integer and non-numeric input by falling back to
 * `null` instead of persisting a nonsensical concurrency cap.
 */
export const parseMaxConcurrentJobsInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
};
