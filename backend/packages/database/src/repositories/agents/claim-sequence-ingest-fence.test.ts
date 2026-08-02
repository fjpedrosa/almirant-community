import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("./claim-sequence-receipt-repository.ts", import.meta.url),
).text();

describe("durable claim receipt ingest fencing", () => {
  test("locks the receipt and job before any durable table insert", () => {
    expect(source).toContain("const lockReceiptForPersistence");
    expect(source).toContain('.for("update")');
    expect(source).toContain("isReceiptSequenceAuthorized");
    expect(source).toContain("await tx.insert(agentJobLogs)");
    expect(source).toContain("await tx.insert(sessionEvents)");
    expect(source).toContain("await tx.insert(agentNativeEvents)");
  });

  test("increments receipt coverage only for rows returned by the atomic insert", () => {
    expect(source).toContain("persistFencedAgentJobLogs");
    expect(source).toContain("persistFencedSessionEvents");
    expect(source).toContain("persistFencedNativeEvents");
    expect(source).toContain("jobLogInsertedCount:");
    expect(source).toContain("sessionEventInsertedCount:");
    expect(source).toContain("nativeEventInsertedCount:");
    expect(source).toContain("inserted.length");
  });

  test("serializes every legacy channel on the job row and rejects any durable receipt", () => {
    expect(source).toContain("const persistReceiptFreeLegacyRows");
    expect(source).toContain("persistReceiptFreeLegacyAgentJobLogs");
    expect(source).toContain("persistReceiptFreeLegacySessionEvents");
    expect(source).toContain("persistReceiptFreeLegacyNativeEvents");
    expect(source).toContain("currentClaimAttemptId");
    expect(source).toContain("agentJobClaimSequenceReceipts.jobId");
    expect(source).toContain('.for("update")');

    const legacyFenceOffset = source.indexOf("const persistReceiptFreeLegacyRows");
    const legacyInsertOffset = source.indexOf(
      "persistReceiptFreeLegacySessionEvents",
      legacyFenceOffset,
    );
    expect(legacyFenceOffset).toBeGreaterThan(-1);
    expect(legacyInsertOffset).toBeGreaterThan(legacyFenceOffset);
  });
});
