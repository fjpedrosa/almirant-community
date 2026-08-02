import type {
  DevFlowAutomationOverridePatchWire,
  ProjectDevFlowAutomationEffective,
  ProjectDevFlowAutomationOverride,
  ProjectDevFlowAutomationRow,
  ProjectDevFlowAutomationStatus,
} from "./types";

/**
 * The fully-inherited override state: every field defers to the card-level
 * default. This is both the starting draft for a row that has never been
 * overridden and the payload shape a "Reset to defaults" action produces.
 */
export const EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE: ProjectDevFlowAutomationOverride = {
  enabled: null,
  codingAgent: null,
  aiProvider: null,
  model: null,
  reasoningLevel: null,
  maxConcurrentJobs: null,
  schedule: null,
};

/** Deep-equal for two override states (schedule is a nested object, everything else is scalar). */
export const devFlowAutomationOverridesEqual = (
  a: ProjectDevFlowAutomationOverride,
  b: ProjectDevFlowAutomationOverride,
): boolean =>
  a.enabled === b.enabled &&
  a.codingAgent === b.codingAgent &&
  a.aiProvider === b.aiProvider &&
  a.model === b.model &&
  a.reasoningLevel === b.reasoningLevel &&
  a.maxConcurrentJobs === b.maxConcurrentJobs &&
  ((a.schedule === null && b.schedule === null) ||
    (a.schedule !== null &&
      b.schedule !== null &&
      a.schedule.expression === b.schedule.expression &&
      a.schedule.timezone === b.schedule.timezone));

/**
 * Serializes a full override draft into the wire shape expected by one
 * automationId's entry in `PATCH /projects/:id/ai-config`'s
 * `agentDefaults.devFlow.automations` map.
 *
 * Per the fixed contract, an ABSENT scalar key means "inherit from the card
 * default" — so every scalar field holding `null` (inherit) in the domain
 * shape must be OMITTED from the wire object, never sent as `null`. The
 * `schedule` field is the one exception: since it's object-valued, "inherit"
 * is expressed as an explicit `schedule: null` rather than by omitting the
 * key. This function is the single place that encodes that asymmetry, so
 * every caller (row save, "Reset to defaults") goes through it rather than
 * hand-building the wire payload.
 */
export const serializeDevFlowAutomationOverride = (
  override: ProjectDevFlowAutomationOverride,
): DevFlowAutomationOverridePatchWire => {
  const wire: DevFlowAutomationOverridePatchWire = {};

  if (override.enabled !== null) wire.enabled = override.enabled;
  if (override.codingAgent !== null) wire.codingAgent = override.codingAgent;
  if (override.aiProvider !== null) wire.aiProvider = override.aiProvider;
  if (override.model !== null) wire.model = override.model;
  if (override.reasoningLevel !== null) wire.reasoningLevel = override.reasoningLevel;
  if (override.maxConcurrentJobs !== null) wire.maxConcurrentJobs = override.maxConcurrentJobs;

  wire.schedule =
    override.schedule === null
      ? null
      : {
          expression: override.schedule.expression,
          ...(override.schedule.timezone !== null ? { timezone: override.schedule.timezone } : {}),
        };

  return wire;
};

/**
 * Builds the WHOLE `agentDefaults.devFlow.automations` wire map for one
 * `PATCH /projects/:id/ai-config` call.
 *
 * The backend treats this map as a wholesale replace, not a merge — so
 * every save (and every reset) must submit the CURRENT desired override for
 * every automation the caller knows about, not just the one being edited.
 * Sending only the edited automationId would silently wipe out every other
 * automation's persisted override.
 *
 * An automationId whose override is fully empty (fully inherited — no
 * override at all) is OMITTED from the map entirely; that's how a full row
 * reset is expressed (the caller forces that entry to
 * `EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE` before calling this). An automationId
 * with a partial override (e.g. it only cleared its schedule but kept other
 * fields) still appears, serialized via `serializeDevFlowAutomationOverride`.
 */
/**
 * Maps GET /dev-flow's `automations` array to a plain
 * automationId -> override record, defaulting a missing override to fully
 * inherited (review fixes #1+#2, issue #235). This is the "current server
 * state" both `useProjectDevFlow`'s card-level save and
 * `useDevFlowAutomationOverrides`'s row save start from before layering
 * their own local draft(s) on top and feeding the result into
 * `buildDevFlowAutomationsPatchPayload` — resending it verbatim is what
 * keeps a save that doesn't touch automations from wiping them out via the
 * backend's wholesale JSONB replace.
 */
export const overridesByAutomationIdFromStatuses = (
  automations: ProjectDevFlowAutomationStatus[],
): Record<string, ProjectDevFlowAutomationOverride> =>
  Object.fromEntries(
    automations.map((automation) => [
      automation.automationId,
      automation.overrides ?? EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    ]),
  );

export const buildDevFlowAutomationsPatchPayload = (
  overridesByAutomationId: Record<string, ProjectDevFlowAutomationOverride>,
): Record<string, DevFlowAutomationOverridePatchWire> => {
  const payload: Record<string, DevFlowAutomationOverridePatchWire> = {};

  for (const [automationId, override] of Object.entries(overridesByAutomationId)) {
    if (devFlowAutomationOverridesEqual(override, EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE)) continue;
    payload[automationId] = serializeDevFlowAutomationOverride(override);
  }

  return payload;
};

// Compact collapsed-row summary, e.g. "claude-code · claude-opus-5 · high · */5 * * * *".
export const formatDevFlowEffectiveSummary = (effective: ProjectDevFlowAutomationEffective): string =>
  [effective.codingAgent, effective.model, effective.reasoningLevel, effective.schedule.expression].join(" · ");

/** One row's draft-derived view state, computed by the overrides hook and overlaid onto the merged row. */
export interface DevFlowAutomationDraftEntry {
  override: ProjectDevFlowAutomationOverride;
  hasChanges: boolean;
  isSaving: boolean;
}

/**
 * Overlays per-automation draft state (unsaved local edits + in-flight save
 * status) onto the rows produced by `mergeDevFlowAutomations`. Rows without
 * a matching entry in `draftsByAutomationId` are returned unchanged — the
 * hook only populates an entry once a row has been touched, deferring to
 * the row's already-merged server `override`/`false`/`false` defaults
 * otherwise.
 */
export const applyDevFlowAutomationDrafts = (
  rows: ProjectDevFlowAutomationRow[],
  draftsByAutomationId: Record<string, DevFlowAutomationDraftEntry>,
): ProjectDevFlowAutomationRow[] =>
  rows.map((row) => {
    const draft = draftsByAutomationId[row.automationId];
    return draft
      ? { ...row, override: draft.override, hasChanges: draft.hasChanges, isSaving: draft.isSaving }
      : row;
  });
