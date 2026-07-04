"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Carries the active-org id seeded from the SERVER session
 * (`session.session.activeOrganizationId`) down to client hooks.
 *
 * Why this exists: Better-Auth's `useActiveOrganization()` resolves the active
 * org via an async fetch, so on the client it is `null` on render 0 and only
 * becomes the real id a tick later. Every org-scoped query key would therefore
 * start life under `org:none` and refetch under `org:<id>` (a double fetch of
 * up to ~550KB on the board). The server already knows the id with zero extra
 * fetches, so we seed it here and let `useActiveTeam` use it as the primary
 * scoping id from render 0 — killing the `org:none` phase.
 *
 * Default `null` means: no provider in the tree (non-dashboard routes) or the
 * session has no active workspace. Both are safe — org-scoped queries stay
 * gated so no cross-workspace data can leak.
 */
const SeededActiveOrgIdContext = createContext<string | null>(null);

export const ActiveOrgProvider = ({
  initialActiveOrgId,
  children,
}: {
  initialActiveOrgId: string | null;
  children: ReactNode;
}) => (
  <SeededActiveOrgIdContext.Provider value={initialActiveOrgId}>
    {children}
  </SeededActiveOrgIdContext.Provider>
);

/**
 * The active-org id seeded from the server session, available synchronously
 * from render 0. A client-side workspace switch is handled by the LIVE org
 * value winning over this seed in `resolveActiveOrgId`, so the seed itself
 * never needs to be mutable.
 */
export const useSeededActiveOrgId = (): string | null =>
  useContext(SeededActiveOrgIdContext);
