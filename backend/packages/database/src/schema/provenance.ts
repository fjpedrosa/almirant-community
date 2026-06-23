/**
 * Common provenance model for tracking the origin of every change
 * across work_item_events, agent_jobs, and ai_sessions.
 *
 * This interface is embedded in existing JSONB `metadata` columns —
 * no new database columns are added.
 */
/**
 * Union of surfaces that can initiate an action.
 * Open-ended via `(string & {})` so unknown sources don't break at runtime.
 */
export type ProvenanceSource = "web" | "websocket" | "api" | "worker" | "nightly" | "mcp" | (string & {});

export interface ProvenanceMetadata {
  /** Surface that initiated the action */
  source?: ProvenanceSource;
  /** The human user who requested this action */
  requestedByUserId?: string;
  /** Denormalized display name of the requesting user */
  requestedByUserName?: string;
  /** Agent job that triggered this change */
  agentJobId?: string;
  /** AI session correlated with this change */
  aiSessionId?: string;
  /** Planning session that originated the work */
  planningSessionId?: string;
  /** Worker that executed the job */
  workerId?: string;
  /** Skill that was running (implement, validate, etc.) */
  skillName?: string;
  /** Process type for grouping */
  processType?: "manual" | "implementation" | "planning" | "review" | "validation" | "bug-fix";
}

/**
 * Maps a provenance source to the closest `event_triggered_by` enum value.
 * Falls back to "system" for unrecognised sources.
 */
const SOURCE_TO_TRIGGERED_BY: Record<string, TriggeredByValue> = {
  web: "user",
  websocket: "websocket",
  api: "api",
  worker: "worker",
  nightly: "nightly",
  mcp: "mcp",
};

/** Valid values for the `event_triggered_by` database enum. */
export type TriggeredByValue = "user" | "system" | "claude-code" | "worker" | "websocket" | "api" | "nightly" | "mcp";

/**
 * Lightweight context object passed to repository functions that record
 * work-item events.  Re-exported here so callers don't need to import
 * from the repository file directly.
 */
export interface TriggeredByContextFromProvenance {
  triggeredBy: TriggeredByValue;
  triggeredByUserId?: string;
  provenance?: ProvenanceMetadata;
}

/**
 * Build a `TriggeredByContext`-compatible object from a `ProvenanceMetadata`
 * instance, centralising the source → triggeredBy mapping that routes and
 * MCP tools otherwise duplicate.
 *
 * @param provenance  The provenance metadata describing the origin of the action.
 * @param userId      Optional override — when supplied it takes precedence over
 *                    `provenance.requestedByUserId`.
 */
export function buildTriggeredByContext(
  provenance: ProvenanceMetadata,
  userId?: string,
): TriggeredByContextFromProvenance {
  const resolvedUserId = userId ?? provenance.requestedByUserId;

  const triggeredBy: TriggeredByValue =
    (provenance.source && SOURCE_TO_TRIGGERED_BY[provenance.source]) ??
    (resolvedUserId ? "user" : "system");

  return {
    triggeredBy,
    triggeredByUserId: resolvedUserId,
    provenance,
  };
}
