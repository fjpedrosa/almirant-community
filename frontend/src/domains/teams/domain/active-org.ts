/**
 * Resolve the active-org id used for query scoping and gating.
 *
 * The live value (from Better-Auth's async `useActiveOrganization()` fetch)
 * wins once it is available. Until then we fall back to the id seeded off the
 * server session (`session.session.activeOrganizationId`), which is present
 * synchronously from render 0. This eliminates the transient `org:none` phase
 * — the root cause of the org-scoped double fetch — while still tracking a
 * client-side workspace switch (the live value overrides the frozen seed).
 *
 * Returns `null` only when the user genuinely has no active workspace, so
 * org-scoped queries stay safely gated (no cross-org data leakage).
 */
export const resolveActiveOrgId = (
  liveOrgId: string | null | undefined,
  seededOrgId: string | null | undefined,
): string | null => liveOrgId ?? seededOrgId ?? null;

/**
 * Pick the active-org id to seed off the server session, agnostic to the build.
 *
 * Community exposes the Better-Auth organization plugin's `activeOrganizationId`.
 * The cloud fork renames the plugin (organization→workspace), so its session
 * carries a custom `activeWorkspaceId` and leaves `activeOrganizationId` unset.
 * Preferring the workspace field, then falling back to the organization field,
 * keeps Phase 2 hydration (the fix for the `org:none` double fetch) working on
 * BOTH builds — in community `activeWorkspaceId` is `undefined`, so it always
 * falls through to `activeOrganizationId` (zero regression).
 *
 * Returns `null` only when neither field resolves an id.
 */
export const pickActiveOrgId = (session: {
  activeWorkspaceId?: string | null;
  activeOrganizationId?: string | null;
}): string | null =>
  session.activeWorkspaceId ?? session.activeOrganizationId ?? null;
