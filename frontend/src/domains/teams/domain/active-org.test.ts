import { describe, expect, it } from "bun:test";
import { resolveActiveOrgId } from "./active-org";

/**
 * S1 (Phase 2): the scoping/gating org id must be STABLE from render 0. It is
 * resolved from the live org fetch when available, else from the id seeded off
 * the server session — never a null/`none` intermediate while the async org
 * fetch is still pending. This is what removes the `org:none` → `org:<id>`
 * double-fetch phase.
 */
describe("resolveActiveOrgId", () => {
  it("returns the live id when the org fetch has resolved", () => {
    expect(resolveActiveOrgId("org-live", "org-seed")).toBe("org-live");
  });

  it("falls back to the seeded session id while live is null (render 0)", () => {
    // The critical guarantee: with a seed present, we NEVER resolve to null
    // (which would produce the `org:none` phase and the double fetch).
    expect(resolveActiveOrgId(null, "org-seed")).toBe("org-seed");
    expect(resolveActiveOrgId(undefined, "org-seed")).toBe("org-seed");
  });

  it("returns null only when the user genuinely has no active org", () => {
    expect(resolveActiveOrgId(null, null)).toBeNull();
    expect(resolveActiveOrgId(undefined, undefined)).toBeNull();
  });

  it("the live id wins over a stale seed after a workspace switch", () => {
    // Seed is frozen at initial page load; a client-side switch updates live.
    expect(resolveActiveOrgId("org-new", "org-old")).toBe("org-new");
  });
});
