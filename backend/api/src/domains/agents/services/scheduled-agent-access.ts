/**
 * Ownership access check for scheduled agent configs (Agents v2). Legacy
 * configs created before ownership existed have `ownerUserId: null`, which
 * keeps them accessible to any workspace member — the same behavior the
 * routes/MCP tools had before ownership was introduced. Configs with a
 * persisted owner are only mutable by that owner.
 */
export const canAccessScheduledAgent = ({
  ownerUserId,
  actorUserId,
}: {
  ownerUserId: string | null | undefined;
  actorUserId: string | null | undefined;
}): boolean => !ownerUserId || ownerUserId === actorUserId;

/**
 * Dev-flow (issue #230): system-managed scheduled agent configs
 * (`managedBy === 'system'`, provisioned by `provisionDevFlowForProject`)
 * are not editable or deletable through the generic scheduled-agent
 * routes/MCP tools — their runtime and enabled flag are only supposed to
 * change through PATCH /projects/:id/ai-config's `devFlow` field, which
 * re-provisions all four in one idempotent pass. Manually triggering one
 * (POST /scheduled-agents/:id/trigger, MCP trigger_agent) is still allowed;
 * this guard is for mutation only.
 */
export class ScheduledAgentConfigSystemManagedError extends Error {
  readonly code = "SCHEDULED_AGENT_CONFIG_SYSTEM_MANAGED";

  constructor() {
    super(
      "This agent is managed by the dev-flow feature and cannot be edited or deleted directly. " +
        "Update it through the project's AI config (PATCH /projects/:id/ai-config, devFlow field) instead.",
    );
    this.name = "ScheduledAgentConfigSystemManagedError";
  }
}

export const assertScheduledAgentConfigIsUserManaged = (config: {
  managedBy?: string | null;
}): void => {
  if (config.managedBy === "system") {
    throw new ScheduledAgentConfigSystemManagedError();
  }
};
