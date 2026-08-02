/**
 * Ported from cloud (issue #64 / community#16) with only the source-anchor
 * end marker adjusted: community declares `cascadeTerminalJobToBugFixAttempt`
 * right after `updateJobStatus` (its original position before this port),
 * not after `updateClaimedJobStatus` as in cloud. The assertions themselves
 * are unchanged — `updateClaimedJobStatus` has no Shoutrz dependency.
 */
import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("./agent-job-repository.ts", import.meta.url),
).text();

describe("claim receipt terminal and release fencing", () => {
  test("requires a ready receipt and finalizes it in the status transaction", () => {
    const functionStart = source.indexOf("export const updateClaimedJobStatus");
    const functionEnd = source.indexOf("export const requestJobTerminalIntent", functionStart);
    const implementation = source.slice(functionStart, functionEnd);

    expect(implementation).toContain("requiresReadySequenceReceipt");
    expect(implementation).toContain("db.transaction(async (tx)");
    expect(implementation).toContain("agentJobClaimSequenceReceipts.state, \"ready\"");
    expect(implementation).toContain('.for("update")');
    expect(implementation).toContain(
      'let finalizedReceiptState: "released" | "terminal"',
    );
    expect(implementation).toContain("state: finalizedReceiptState");
    expect(implementation).toContain("pendingTerminalIntentData");
    expect(implementation.indexOf("tx.update(agentJobs)")).toBeLessThan(
      implementation.indexOf("tx.update(agentJobClaimSequenceReceipts)"),
    );
  });
});
