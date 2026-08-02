import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/orchestrator.ts", import.meta.url),
  "utf8",
);

describe("legacy in-process worker claim fencing", () => {
  it("retains the exact claim snapshot and terminalizes only through the legacy CAS", () => {
    expect(source).toContain("updateLegacyClaimedJobStatus");
    expect(source).toContain("legacyClaimSnapshots");
    expect(source).toContain("expectedUpdatedAt: claimSnapshot.updatedAt");

    const onJobCompleted = source.match(
      /const onJobCompleted[\s\S]*?\n  };/,
    )?.[0];
    expect(onJobCompleted).toContain("terminalizeLegacyClaim");
    expect(onJobCompleted).not.toContain('updateJobStatus(jobId, "completed"');
  });

  it("routes every permanent failure through the same first-writer-wins CAS", () => {
    expect(source).toContain("const terminalizeLegacyClaim");
    expect(source).not.toContain('updateJobStatus(jobId, "failed"');
    expect(source).toContain('terminalizeLegacyClaim(jobId, "failed"');
  });
});
