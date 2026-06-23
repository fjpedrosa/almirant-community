/**
 * Suggested ownership map by system boundary.
 *
 * Maps each known boundary (as inferred by `inferBoundary` from error-fingerprint.ts)
 * to a responsible team and escalation contact. Used to enrich agent job responses
 * with actionable ownership information.
 */

export interface BoundaryOwnership {
  team: string;
  escalation: string;
}

export const BOUNDARY_OWNERSHIP: Record<string, BoundaryOwnership> = {
  runner: { team: "platform", escalation: "runner-oncall" },
  "web-bridge": { team: "platform", escalation: "bridge-oncall" },
  frontend: { team: "frontend", escalation: "frontend-oncall" },
  "backend-api": { team: "backend", escalation: "api-oncall" },
  database: { team: "backend", escalation: "db-oncall" },
  "stream-consumer": { team: "platform", escalation: "stream-oncall" },
  scaler: { team: "platform", escalation: "infra-oncall" },
  websocket: { team: "platform", escalation: "ws-oncall" },
  shim: { team: "platform", escalation: "shim-oncall" },
  "discord-bridge": { team: "platform", escalation: "bridge-oncall" },
  unknown: { team: "unassigned", escalation: "engineering-lead" },
};

/**
 * Returns the suggested ownership for a given boundary string.
 * Falls back to the "unknown" entry when the boundary is not recognized.
 */
export const getSuggestedOwnership = (boundary: string): BoundaryOwnership => {
  return BOUNDARY_OWNERSHIP[boundary] ?? BOUNDARY_OWNERSHIP["unknown"]!;
};
