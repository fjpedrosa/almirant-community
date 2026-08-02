import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentJobClaimSequenceReceipts } from "../../schema/agent-job-claim-sequence-receipts";
import {
  CLAIM_RECEIPT_CURRENT_JOB_STATUSES,
  MAX_DURABLE_SEQUENCE,
  SEQUENCE_RESERVATION_BLOCK_SIZE,
  calculateSequenceReservationEnd,
  calculateExpectedInsertedCount,
  isReceiptSequenceAuthorized,
} from "./claim-sequence-receipt-repository";

describe("claim sequence receipt contract", () => {
  test("keeps an answered-interaction claim current while waiting for input", () => {
    expect(CLAIM_RECEIPT_CURRENT_JOB_STATUSES).toEqual([
      "running",
      "finalizing",
      "waiting_for_input",
    ]);
  });

  test("stores one independently fenced range and progress counter per channel", () => {
    const config = getTableConfig(agentJobClaimSequenceReceipts);
    const columnNames = config.columns.map((column) => column.name);

    expect(columnNames).toEqual(
      expect.arrayContaining([
        "job_id",
        "claim_attempt_id",
        "worker_id",
        "state",
        "job_log_sequence_start",
        "job_log_sequence_end",
        "job_log_emitted_through",
        "job_log_inserted_count",
        "session_event_sequence_start",
        "session_event_sequence_end",
        "session_event_emitted_through",
        "session_event_inserted_count",
        "native_event_sequence_start",
        "native_event_sequence_end",
        "native_event_emitted_through",
        "native_event_inserted_count",
      ]),
    );

    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "job_id",
      "claim_attempt_id",
    ]);
  });

  test("extends reservations in bounded blocks without overflowing int32", () => {
    expect(SEQUENCE_RESERVATION_BLOCK_SIZE).toBe(4_096);
    expect(calculateSequenceReservationEnd(10, 11)).toBe(4_106);
    expect(calculateSequenceReservationEnd(10, 4_106)).toBe(4_106);
    expect(calculateSequenceReservationEnd(10, 4_107)).toBe(8_202);
    expect(
      calculateSequenceReservationEnd(MAX_DURABLE_SEQUENCE - 5, MAX_DURABLE_SEQUENCE),
    ).toBe(MAX_DURABLE_SEQUENCE);
    expect(() => calculateSequenceReservationEnd(10, MAX_DURABLE_SEQUENCE + 1)).toThrow(
      "Invalid required durable sequence",
    );
  });

  test("authorizes exact current or historical receipts only inside their safe bounds", () => {
    const active = {
      state: "active" as const,
      start: 101,
      end: 4_196,
      emittedThrough: null,
      isCurrentClaim: true,
    };
    expect(isReceiptSequenceAuthorized(active, 101)).toBe(true);
    expect(isReceiptSequenceAuthorized(active, 4_197)).toBe(false);
    expect(isReceiptSequenceAuthorized({ ...active, isCurrentClaim: false }, 101)).toBe(false);

    const released = {
      state: "released" as const,
      start: 101,
      end: 4_196,
      emittedThrough: 120,
      isCurrentClaim: false,
    };
    expect(isReceiptSequenceAuthorized(released, 120)).toBe(true);
    expect(isReceiptSequenceAuthorized(released, 121)).toBe(false);

    const crashed = {
      state: "crashed" as const,
      start: 101,
      end: 4_196,
      emittedThrough: null,
      isCurrentClaim: false,
    };
    expect(isReceiptSequenceAuthorized(crashed, 4_196)).toBe(true);
    expect(isReceiptSequenceAuthorized(crashed, 4_197)).toBe(false);
  });

  test("derives exact handoff coverage from the reserved start", () => {
    expect(calculateExpectedInsertedCount(101, 100)).toBe(0);
    expect(calculateExpectedInsertedCount(101, 101)).toBe(1);
    expect(calculateExpectedInsertedCount(101, 120)).toBe(20);
    expect(() => calculateExpectedInsertedCount(101, 99)).toThrow(
      "Invalid emitted durable sequence",
    );
  });
});
