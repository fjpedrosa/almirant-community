interface ShouldResetAgentFormInput {
  prevOpen: boolean;
  nextOpen: boolean;
  prevConfigId: string | null;
  nextConfigId: string | null;
}

/**
 * Decide whether the scheduled-agent form should be reset on a given render.
 *
 * Rule: only reset on the closed -> open transition, or when the edited config
 * id actually changes while the drawer is already open. Do NOT reset on every
 * config reference change (e.g. React Query refetch returning new object
 * identity for the same record), because that wipes what the user is typing
 * mid-edit (see feedback 40c1c45c — "Se cambia mi prompt por un texto de
 * system prompt posiblemente").
 */
function shouldResetAgentForm({
  prevOpen,
  nextOpen,
  prevConfigId,
  nextConfigId,
}: ShouldResetAgentFormInput): boolean {
  if (!nextOpen) return false;
  const wasClosed = !prevOpen;
  const configChanged = prevConfigId !== nextConfigId;
  return wasClosed || configChanged;
}

export { shouldResetAgentForm };
export type { ShouldResetAgentFormInput };
