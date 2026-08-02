import { describe, expect, it } from "bun:test";
import { canAccessScheduledAgent } from "./scheduled-agent-access";

describe("scheduled agent access", () => {
  it("keeps legacy ownerless agents workspace-accessible", () => {
    expect(
      canAccessScheduledAgent({ ownerUserId: null, actorUserId: "user-2" }),
    ).toBe(true);
  });

  it("allows the persisted owner and rejects another workspace member", () => {
    expect(
      canAccessScheduledAgent({ ownerUserId: "user-1", actorUserId: "user-1" }),
    ).toBe(true);
    expect(
      canAccessScheduledAgent({ ownerUserId: "user-1", actorUserId: "user-2" }),
    ).toBe(false);
  });
});
