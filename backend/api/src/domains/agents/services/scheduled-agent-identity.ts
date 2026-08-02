export interface ScheduledAgentExecutionIdentityInput {
  ownerUserId: string | null | undefined;
  requestedByUserId: string | null | undefined;
}

export interface ScheduledAgentExecutionIdentity {
  /** Persisted actor used for credentials, MCP sessions, storage, and usage. */
  createdByUserId: string | null;
  /** Human who explicitly requested this execution, when one exists. */
  requestedByUserId: string | null;
}

/**
 * Resolve the two distinct identities attached to an agent execution.
 *
 * New agents always have an owner, so their jobs run as that owner. Legacy
 * rows can still have a null owner: manual runs retain their historical
 * behavior by falling back to the authenticated requester, while unattended
 * runs remain system-authored.
 */
export const resolveScheduledAgentExecutionIdentity = (
  input: ScheduledAgentExecutionIdentityInput,
): ScheduledAgentExecutionIdentity => {
  const ownerUserId = input.ownerUserId?.trim() || null;
  const requestedByUserId = input.requestedByUserId?.trim() || null;

  return {
    createdByUserId: ownerUserId ?? requestedByUserId,
    requestedByUserId,
  };
};

/**
 * Resolve the `createdByUserId` a scheduled-agent job should persist,
 * falling back to the workspace owner when neither the config's persisted
 * owner nor an explicit human requester is available.
 *
 * New `scheduled_agent_configs` rows always carry `ownerUserId` (enforced at
 * scheduled-agents.routes.ts:629). Legacy rows can still have
 * `ownerUserId: null`; without this fallback their jobs persist
 * `createdByUserId: null`, which the sessions UI renders as "Almirant[bot]"
 * even though the workspace has a real member who owns it.
 *
 * IMPORTANT — call this ONCE per dispatch (config), never once per
 * candidate/job: callers with a per-candidate job-creation loop (the four
 * built-in dispatcher automations in scheduled-agent-dispatcher.ts —
 * backlogDrain/dodRemediation/dodReview/candidateBased) must resolve this
 * BEFORE the loop and reuse the value for every `createJob` call inside it,
 * so one dispatch tick issues at most one `member` query, not one per job.
 */
export const resolveScheduledDispatchCreatedByUserId = async (
  resolvedUserId: string | null | undefined,
  workspaceId: string,
  getWorkspaceOwnerUserId: (workspaceId: string) => Promise<string | null>,
): Promise<string | undefined> => {
  const trimmed = resolvedUserId?.trim() || undefined;
  if (trimmed) return trimmed;
  const fallback = await getWorkspaceOwnerUserId(workspaceId);
  return fallback ?? undefined;
};
