import React from "react";
import { afterAll, describe, expect, it, mock } from "bun:test";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Safe to import statically: this module does NOT pull in `@/lib/auth-client`.
import { ActiveOrgProvider } from "@/domains/teams/application/active-org-context";

/**
 * CONTRACT (the guardrail for S1/2B).
 *
 * The double fetch had two roots:
 *   1. The client hook scoped every key with `org:none` first (async org id).
 *   2. The RSC pages prefetched WITHOUT the `org:<id>` suffix, so hydration
 *      never matched and the client refetched anyway.
 *
 * The fix routes BOTH sides through the single pure `orgScopedKey`. These tests
 * pin two invariants:
 *   (A) the client hook `useOrgScopedKey(base)` === the server key
 *       `orgScopedKey(base, id)` for boards and projects (no drift possible);
 *   (B) with an id seeded from the session, the scoped key is `org:<id>` from
 *       render 0 even while the live org fetch is still null — i.e. there is NO
 *       `org:none` phase (this is what removes the double fetch).
 *
 * We mock `@/lib/auth-client` (the real one throws at import when the NEXT base
 * URL is null) so we can drive the live active-org value, mirroring the
 * existing `use-work-item-board.test.tsx` setup.
 */

let mockLiveOrg: { id: string } | null = null;
let mockIsPending = false;

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: mockLiveOrg, isPending: mockIsPending }),
    organization: {
      setActive: async () => ({ error: null }),
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const createWrapper = (seededOrgId: string | null = null) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ActiveOrgProvider initialActiveOrgId={seededOrgId}>
        {children}
      </ActiveOrgProvider>
    </QueryClientProvider>
  );
  return Wrapper;
};

describe("orgScopedKey contract: client hook === server prefetch key", () => {
  it("boards: useOrgScopedKey(listByArea) === orgScopedKey(listByArea, id)", async () => {
    mockLiveOrg = { id: "org-abc" };
    mockIsPending = false;

    const { orgScopedKey } = await import("./org-scoped-key");
    const { useOrgScopedKey } = await import("./query-keys");
    const { boardKeys } = await import(
      "@/domains/boards/application/hooks/use-boards"
    );

    const area = "desarrollo";
    const { result } = renderHook(
      () => useOrgScopedKey(boardKeys.listByArea(area)),
      { wrapper: createWrapper() },
    );

    const serverKey = orgScopedKey(boardKeys.listByArea(area), "org-abc");
    expect(result.current).toEqual(serverKey);
    // Pin the concrete literal so the suffix format cannot silently change.
    expect(result.current).toEqual([
      "boards",
      "list",
      "area",
      "desarrollo",
      "org:org-abc",
    ]);
  });

  it("projects: useOrgScopedKey(list('')) === orgScopedKey(list(''), id)", async () => {
    mockLiveOrg = { id: "org-abc" };
    mockIsPending = false;

    const { orgScopedKey } = await import("./org-scoped-key");
    const { useOrgScopedKey } = await import("./query-keys");
    const { projectKeys } = await import(
      "@/domains/projects/application/hooks/use-projects"
    );

    const { result } = renderHook(
      () => useOrgScopedKey(projectKeys.list("")),
      { wrapper: createWrapper() },
    );

    const serverKey = orgScopedKey(projectKeys.list(""), "org-abc");
    expect(result.current).toEqual(serverKey);
    expect(result.current).toEqual(["projects", "list", "", "org:org-abc"]);
  });
});

describe("org-id seeding (2A): no `org:none` phase when the session has an org", () => {
  it("uses the seeded session id while the live org fetch is still null", async () => {
    // Render 0 reality: the async org fetch has not resolved yet.
    mockLiveOrg = null;
    mockIsPending = true;

    const { useOrgScopedKey } = await import("./query-keys");
    const { boardKeys } = await import(
      "@/domains/boards/application/hooks/use-boards"
    );

    const { result } = renderHook(
      () => useOrgScopedKey(boardKeys.listByArea("desarrollo")),
      { wrapper: createWrapper("org-seed") },
    );

    // MUST be scoped to the seeded org, NOT `org:none`.
    expect(result.current[result.current.length - 1]).toBe("org:org-seed");
    expect(result.current).toEqual([
      "boards",
      "list",
      "area",
      "desarrollo",
      "org:org-seed",
    ]);
  });

  it("the live org id wins over the seed once the fetch resolves (switch-safe)", async () => {
    mockLiveOrg = { id: "org-live" };
    mockIsPending = false;

    const { useOrgScopedKey } = await import("./query-keys");
    const { boardKeys } = await import(
      "@/domains/boards/application/hooks/use-boards"
    );

    const { result } = renderHook(
      () => useOrgScopedKey(boardKeys.listByArea("desarrollo")),
      { wrapper: createWrapper("org-seed") },
    );

    expect(result.current[result.current.length - 1]).toBe("org:org-live");
  });
});
