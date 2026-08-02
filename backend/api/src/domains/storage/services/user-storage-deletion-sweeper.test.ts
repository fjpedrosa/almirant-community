import { describe, expect, it, mock } from "bun:test";
import { runUserStorageDeletionSweepOnce } from "./user-storage-deletion-sweeper";

describe("user storage deletion sweeper", () => {
  it("drains a bounded batch from the durable object deletion queue", async () => {
    const drainDeletionQueue = mock(async () => ({ completed: 2, failed: 1 }));

    const result = await runUserStorageDeletionSweepOnce(
      { drainDeletionQueue },
      75,
    );

    expect(drainDeletionQueue).toHaveBeenCalledWith(75);
    expect(result).toEqual({ completed: 2, failed: 1 });
  });
});
