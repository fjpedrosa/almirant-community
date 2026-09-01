import { describe, expect, it } from "bun:test";
import { canDeleteWorkItem } from "./work-item-delete";

describe("canDeleteWorkItem", () => {
  it("allows only leaf tasks", () => {
    expect(canDeleteWorkItem({ type: "task", childrenCount: 0 })).toBe(true);
    expect(canDeleteWorkItem({ type: "feature", childrenCount: 0 })).toBe(false);
    expect(canDeleteWorkItem({ type: "task", childrenCount: 1 })).toBe(false);
  });
});
