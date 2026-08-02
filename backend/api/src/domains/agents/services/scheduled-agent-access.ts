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
