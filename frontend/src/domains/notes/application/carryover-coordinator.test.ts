import { describe, expect, it } from "bun:test";
import { createCarryoverCoordinator, resetCarryoverCoordinators } from "./carryover-coordinator";

describe("carryover coordinators", () => {
  it("evicts a paused conflict and resumes the refreshed source version on retry", async () => {
    const conflict = Object.assign(new Error("conflict"), { code: "NOTE_VERSION_CONFLICT" });
    let attempts = 0;
    const item = { sourcePageId: "10000000-0000-4000-8000-000000000001", sourceStateVersion: 1 };
    const command = async (expectedVersion: number) => {
      attempts += 1;
      if (attempts === 1) throw conflict;
      return { stateVersion: expectedVersion + 1, page: {} };
    };
    const first = createCarryoverCoordinator(item);
    await expect(first.serialize(command)).rejects.toBe(conflict);
    const retry = createCarryoverCoordinator({ ...item, sourceStateVersion: 2 });
    expect(retry).not.toBe(first);
    await expect(retry.serialize(command)).resolves.toMatchObject({ stateVersion: 3 });
    resetCarryoverCoordinators();
  });
});
