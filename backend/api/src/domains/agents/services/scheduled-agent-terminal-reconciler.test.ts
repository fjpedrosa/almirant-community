import { describe, expect, it } from "bun:test";
import { createScheduledAgentTerminalReconciler } from "./scheduled-agent-terminal-reconciler";

describe("scheduled agent terminal reconciler", () => {
  it("finalizes required output before projecting the scheduled run outcome", async () => {
    const events: string[] = [];
    const reconciler = createScheduledAgentTerminalReconciler({
      finalizeOutput: async () => {
        events.push("terminal_error");
        return { reconciled: true };
      },
      reconcileRun: async () => {
        events.push("run_failed");
        return { reconciled: true };
      },
    });

    expect(await reconciler.reconcile("job-1")).toBe(true);
    expect(events).toEqual(["terminal_error", "run_failed"]);
  });

  it("still reconciles the run when an idempotent output replay is already durable", async () => {
    const reconciler = createScheduledAgentTerminalReconciler({
      finalizeOutput: async () => ({ reconciled: false }),
      reconcileRun: async () => ({ reconciled: true }),
    });

    expect(await reconciler.reconcile("job-1")).toBe(true);
  });
});
