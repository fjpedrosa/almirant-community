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
