/**
 * Pure org-scoping key composer.
 *
 * This is the SINGLE source of truth for how an org-scoped React Query key is
 * built. It is deliberately framework-free (no `"use client"`) so the SAME
 * function runs on BOTH sides of the SSR boundary:
 *
 *  - the client hook `useOrgScopedKey` delegates to it, and
 *  - server components (RSC pages) call it directly when prefetching.
 *
 * If the two sides ever built the key differently the dehydrated cache would
 * miss on hydration and the client would refetch (the ~550KB board double
 * fetch). Sharing this one function makes that mismatch impossible.
 *
 * @example
 * orgScopedKey(boardKeys.listByArea("desarrollo"), "abc")
 * // → ["boards", "list", "area", "desarrollo", "org:abc"]
 */
export const ORG_KEY_NONE = "none";

export const orgScopedKey = <T extends readonly unknown[]>(
  baseKey: T,
  orgId: string | null | undefined,
): readonly unknown[] => [...baseKey, `org:${orgId ?? ORG_KEY_NONE}`];
