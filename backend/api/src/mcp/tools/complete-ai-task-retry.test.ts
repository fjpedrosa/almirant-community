import { describe, expect, it } from "bun:test";
import {
  isRetryableCompleteAiTaskError,
  runWithCompleteAiTaskRetry,
} from "./complete-ai-task-retry";

describe("complete_ai_task retry policy", () => {
  it("retries transient board-position updates up to success", async () => {
    let attempts = 0;

    const result = await runWithCompleteAiTaskRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('Failed query: update "work_items" set "position" = "work_items"."position" + 1');
        }
        return true;
      },
      { baseDelayMs: 0 },
    );

    expect(result).toBe(true);
    expect(attempts).toBe(3);
  });

  it("does not retry deterministic validation errors", async () => {
    let attempts = 0;

    await expect(
      runWithCompleteAiTaskRetry(
        async () => {
          attempts += 1;
          throw new Error("BOARD_COLUMN_NOT_FOUND: Column was not found");
        },
        { baseDelayMs: 0 },
      ),
    ).rejects.toThrow("BOARD_COLUMN_NOT_FOUND");

    expect(attempts).toBe(1);
  });

  it("classifies lock/deadlock/serialization failures as retryable", () => {
    expect(isRetryableCompleteAiTaskError(new Error("deadlock detected"))).toBe(true);
    expect(isRetryableCompleteAiTaskError(new Error("could not serialize access due to concurrent update"))).toBe(true);
    expect(isRetryableCompleteAiTaskError(new Error("canceling statement due to lock timeout"))).toBe(true);
  });
});
