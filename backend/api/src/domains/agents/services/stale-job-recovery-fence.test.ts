/**
 * Ported from cloud (issue #64 / community#16c) minus the "keeps a validated
 * agent output instead of failing its job" case: it asserts on
 * `shouldPreserveValidatedOutputOnRecovery`/`completeRecoveredJobWithValidatedOutput`,
 * a separate feature (preserving a post-session-end validated output when the
 * runner's terminal status report can never arrive) that is not part of the
 * receipts protocol and does not exist in community. The direct-update tally
 * in the first case is adjusted from cloud's 6 to 5: community has no
 * `completeRecoveredJobWithValidatedOutput` call site.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stale-job-recovery.ts", import.meta.url),
  "utf8",
);

describe("stale job recovery claim-generation fencing", () => {
  it("fences every direct agent_jobs update to the selected row generation", () => {
    const directUpdates = source.match(
      /\.update\(agentJobs\)[\s\S]*?\.returning\(getTableColumns\(agentJobs\)\);/g,
    );

    expect(directUpdates).toHaveLength(1);
    for (const update of directUpdates ?? []) {
      expect(update).toContain(".where(selectedJobFence(");
    }
    // One definition plus every sweep's write. Raise this only when the new call
    // really is a fenced recovery write — the point of the tally is that nobody
    // reaches agent_jobs by any other route.
    expect(source.match(/recoverStaleJobWithReceipt\(/g)).toHaveLength(5);
  });

  it("matches claim identity plus the selected progress snapshot", () => {
    const fence = source.match(
      /const selectedJobFence[\s\S]*?\n};/,
    )?.[0];

    expect(fence).toContain("eq(agentJobs.id, job.id)");
    expect(fence).toContain("eq(agentJobs.status, job.status)");
    expect(fence).toContain("eq(agentJobs.workerId, job.workerId)");
    expect(fence).toContain("xmin::text = ${job.recoveryXmin}");
    expect(fence).toContain(
      '"updated_at"::text = ${job.recoveryUpdatedAt}',
    );
    expect(fence).toContain("eq(agentJobs.sessionId, job.sessionId)");
    expect(fence).toContain("eq(agentJobs.availableAt, job.availableAt)");
    expect(fence).toContain("'claimAttemptId' = ${claimAttemptId}");
    expect(fence).toContain("COALESCE(${agentJobs.config} ->> 'claimAttemptId', '') = ''");
    expect(source).toContain("const recoveryJobSelection");
    expect(source).toContain("toRecoveryJobSnapshot");
  });

  it("serializes the startup cutoff and qualifies the outer job correlation", () => {
    const startupWatchdog = source.match(
      /\/\/ --- Pre-session startup watchdog[\s\S]*?\/\/ --- Timeout sweep/,
    )?.[0];

    expect(startupWatchdog).toContain("${agentJobs.id}");
    expect(startupWatchdog).toContain("const cutoffIso = cutoff.toISOString()");
    expect(startupWatchdog).toContain("${cutoffIso}");
    expect(startupWatchdog).not.toContain("srl.timestamp < ${cutoff}");
  });

  it("marks a durable receipt crashed in the same transaction before requeue/failure", () => {
    expect(source).toContain("const recoverStaleJobWithReceipt");
    expect(source).toContain("db.transaction(async (tx)");
    expect(source).toContain("agentJobClaimSequenceReceipts");
    expect(source).toContain('state: "crashed"');
    expect(source).toContain('.for("update")');
  });

  it("applies and clears the first pending terminal intent inside the fenced recovery", () => {
    const recovery = source.match(
      /const recoverStaleJobWithReceipt[\s\S]*?\n};/,
    )?.[0];

    expect(recovery).toContain("resolveStaleRecoveryTerminalIntent");
    expect(recovery).toContain("pendingTerminalIntent");
    expect(recovery).toContain("terminalIntent.status");
    expect(recovery).toContain("terminalIntent.completedAt");
    expect(recovery).toContain("terminalIntent.failedAt");
    expect(recovery).toContain("- 'claimAttemptId' - 'pendingTerminalIntent'");
    expect(source).toContain("cascadeRecoveredTerminalJob");
    expect(source).toContain("failActiveAttemptForCancelledJob");
  });
});
