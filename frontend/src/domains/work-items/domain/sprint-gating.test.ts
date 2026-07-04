import { describe, expect, it } from "bun:test";
import { isSprintSelectionResolved } from "./sprint-gating";

describe("isSprintSelectionResolved (single fetch with correct sprint filter)", () => {
  it("is NOT resolved while the active-sprint query is still loading and no manual pick", () => {
    // This is the window where firing the board query would use an empty sprint
    // filter and then refetch — so it must stay gated.
    expect(isSprintSelectionResolved(false, true)).toBe(false);
  });

  it("is resolved once the active-sprint query settles", () => {
    expect(isSprintSelectionResolved(false, false)).toBe(true);
  });

  it("is resolved immediately when the user made a manual selection", () => {
    expect(isSprintSelectionResolved(true, true)).toBe(true);
    expect(isSprintSelectionResolved(true, false)).toBe(true);
  });
});
