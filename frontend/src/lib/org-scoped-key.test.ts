import { describe, expect, it } from "bun:test";
import { orgScopedKey, ORG_KEY_NONE } from "./org-scoped-key";

/**
 * S1 (Phase 2): `orgScopedKey` is the SINGLE pure composer for org-scoped
 * query keys, shared by the client hook (`useOrgScopedKey`) and server-side
 * RSC prefetch. Both must produce byte-identical keys or SSR hydration misses.
 * (The client-hook === server-prefetch contract is proven in
 * `org-scoped-key.contract.test.tsx`.)
 */
describe("orgScopedKey (pure key composer)", () => {
  it("appends the `org:<id>` suffix as the LAST element", () => {
    const key = orgScopedKey(["boards", "list"], "org-123");
    expect(key).toEqual(["boards", "list", "org:org-123"]);
    expect(key[key.length - 1]).toBe("org:org-123");
  });

  it("falls back to `org:none` when the id is null or undefined", () => {
    expect(orgScopedKey(["x"], null)).toEqual(["x", `org:${ORG_KEY_NONE}`]);
    expect(orgScopedKey(["x"], undefined)).toEqual(["x", "org:none"]);
  });

  it("preserves the base key prefix and does not mutate the input", () => {
    const base = ["boards", "list", "area", "desarrollo"] as const;
    const snapshot = [...base];
    const key = orgScopedKey(base, "org-9");

    expect(key.slice(0, base.length)).toEqual([...base]);
    // Input untouched (immutability).
    expect([...base]).toEqual(snapshot);
  });
});
