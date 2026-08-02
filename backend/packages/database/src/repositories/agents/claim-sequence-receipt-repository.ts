import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  DURABLE_SESSION_EVENT_CONFLICT_PREDICATE,
  agentJobClaimSequenceReceipts,
  agentJobLogs,
  agentJobs,
  agentNativeEvents,
  sessionEvents,
} from "../../schema";
import type { NewAgentJobLog } from "../../schema/agent-job-logs";
import type { NewAgentNativeEvent } from "../../schema/agent-native-events";
import type { NewSessionEvent } from "../../schema/session-events";
import type { ClaimSequenceReceiptState } from "../../schema/agent-job-claim-sequence-receipts";

export const MAX_DURABLE_SEQUENCE = 2_147_483_647;
export const SEQUENCE_RESERVATION_BLOCK_SIZE = 4_096;
export const CLAIM_RECEIPT_CURRENT_JOB_STATUSES = [
  "running",
  "finalizing",
  "waiting_for_input",
] as const;

export type ClaimSequenceChannel = "jobLogs" | "sessionEvents" | "nativeEvents";

export class ClaimSequenceReceiptConflictError extends Error {
  constructor(message = "Job claim sequence receipt is no longer active") {
    super(message);
    this.name = "ClaimSequenceReceiptConflictError";
  }
}

export const calculateSequenceReservationEnd = (
  currentEnd: number,
  requiredThrough: number,
): number => {
  if (
    !Number.isInteger(currentEnd) ||
    currentEnd < 0 ||
    currentEnd > MAX_DURABLE_SEQUENCE
  ) {
    throw new Error("Invalid current durable sequence reservation");
  }
  if (
    !Number.isInteger(requiredThrough) ||
    requiredThrough < 0 ||
    requiredThrough > MAX_DURABLE_SEQUENCE
  ) {
    throw new Error("Invalid required durable sequence");
  }
  if (requiredThrough <= currentEnd) return currentEnd;

  const missing = requiredThrough - currentEnd;
  const blocks = Math.ceil(missing / SEQUENCE_RESERVATION_BLOCK_SIZE);
  return Math.min(
    MAX_DURABLE_SEQUENCE,
    currentEnd + blocks * SEQUENCE_RESERVATION_BLOCK_SIZE,
  );
};

export type ReceiptSequenceAuthorization = Readonly<{
  state: ClaimSequenceReceiptState;
  start: number;
  end: number;
  emittedThrough: number | null;
  isCurrentClaim: boolean;
}>;

export const isReceiptSequenceAuthorized = (
  receipt: ReceiptSequenceAuthorization,
  sequence: number,
): boolean => {
  if (!Number.isInteger(sequence) || sequence < receipt.start || sequence > receipt.end) {
    return false;
  }

  if (receipt.state === "active") return receipt.isCurrentClaim;
  if (receipt.state === "crashed") return true;

  if (receipt.emittedThrough === null || sequence > receipt.emittedThrough) {
    return false;
  }

  if (receipt.state === "draining" || receipt.state === "ready") {
    return receipt.isCurrentClaim;
  }

  return receipt.state === "released" || receipt.state === "terminal";
};

export const calculateExpectedInsertedCount = (
  start: number,
  emittedThrough: number,
): number => {
  if (!Number.isInteger(start) || start < 1 || start > MAX_DURABLE_SEQUENCE) {
    throw new Error("Invalid durable sequence reservation start");
  }
  if (
    !Number.isInteger(emittedThrough) ||
    emittedThrough < start - 1 ||
    emittedThrough > MAX_DURABLE_SEQUENCE
  ) {
    throw new Error("Invalid emitted durable sequence");
  }
  return emittedThrough - start + 1;
};

type ReceiptRow = typeof agentJobClaimSequenceReceipts.$inferSelect;

const getChannelProgress = (
  receipt: ReceiptRow,
  channel: ClaimSequenceChannel,
): Readonly<{
  start: number;
  end: number;
  emittedThrough: number | null;
  insertedCount: number;
}> => {
  switch (channel) {
    case "jobLogs":
      return {
        start: receipt.jobLogSequenceStart,
        end: receipt.jobLogSequenceEnd,
        emittedThrough: receipt.jobLogEmittedThrough,
        insertedCount: receipt.jobLogInsertedCount,
      };
    case "sessionEvents":
      return {
        start: receipt.sessionEventSequenceStart,
        end: receipt.sessionEventSequenceEnd,
        emittedThrough: receipt.sessionEventEmittedThrough,
        insertedCount: receipt.sessionEventInsertedCount,
      };
    case "nativeEvents":
      return {
        start: receipt.nativeEventSequenceStart,
        end: receipt.nativeEventSequenceEnd,
        emittedThrough: receipt.nativeEventEmittedThrough,
        insertedCount: receipt.nativeEventInsertedCount,
      };
  }
};

const getReservationEndPatch = (
  channel: ClaimSequenceChannel,
  reservedThrough: number,
): Partial<ReceiptRow> => {
  switch (channel) {
    case "jobLogs":
      return { jobLogSequenceEnd: reservedThrough };
    case "sessionEvents":
      return { sessionEventSequenceEnd: reservedThrough };
    case "nativeEvents":
      return { nativeEventSequenceEnd: reservedThrough };
  }
};

const lockCurrentReceipt = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: Readonly<{
    jobId: string;
    workerId: string;
    claimAttemptId: string;
  }>,
) => {
  const [row] = await tx
    .select({
      receipt: agentJobClaimSequenceReceipts,
      currentClaimAttemptId: sql<string | null>`${agentJobs.config} ->> 'claimAttemptId'`,
      currentWorkerId: agentJobs.workerId,
    })
    .from(agentJobClaimSequenceReceipts)
    .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
    .where(
      and(
        eq(agentJobClaimSequenceReceipts.jobId, input.jobId),
        eq(agentJobClaimSequenceReceipts.claimAttemptId, input.claimAttemptId),
        eq(agentJobClaimSequenceReceipts.workerId, input.workerId),
        eq(agentJobs.workerId, input.workerId),
        inArray(agentJobs.status, CLAIM_RECEIPT_CURRENT_JOB_STATUSES),
        sql`${agentJobs.config} ->> 'claimAttemptId' = ${input.claimAttemptId}`,
      ),
    )
    .for("update");

  if (
    !row ||
    row.currentWorkerId !== input.workerId ||
    row.currentClaimAttemptId !== input.claimAttemptId
  ) {
    throw new ClaimSequenceReceiptConflictError();
  }
  return row.receipt;
};

const lockReceiptForPersistence = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: Readonly<{
    jobId: string;
    claimAttemptId: string;
    expectedWorkerId?: string;
  }>,
): Promise<ReceiptSequenceAuthorization & { receipt: ReceiptRow }> => {
  const [row] = await tx
    .select({
      receipt: agentJobClaimSequenceReceipts,
      currentClaimAttemptId: sql<string | null>`${agentJobs.config} ->> 'claimAttemptId'`,
      currentWorkerId: agentJobs.workerId,
      currentStatus: agentJobs.status,
    })
    .from(agentJobClaimSequenceReceipts)
    .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
    .where(
      and(
        eq(agentJobClaimSequenceReceipts.jobId, input.jobId),
        eq(agentJobClaimSequenceReceipts.claimAttemptId, input.claimAttemptId),
      ),
    )
    .for("update");

  if (!row) throw new ClaimSequenceReceiptConflictError();
  if (
    input.expectedWorkerId !== undefined &&
    row.receipt.workerId !== input.expectedWorkerId
  ) {
    throw new ClaimSequenceReceiptConflictError();
  }

  const isCurrentClaim =
    row.currentClaimAttemptId === row.receipt.claimAttemptId &&
    row.currentWorkerId === row.receipt.workerId &&
    CLAIM_RECEIPT_CURRENT_JOB_STATUSES.includes(
      row.currentStatus as (typeof CLAIM_RECEIPT_CURRENT_JOB_STATUSES)[number],
    );

  return {
    receipt: row.receipt,
    state: row.receipt.state,
    start: 0,
    end: 0,
    emittedThrough: null,
    isCurrentClaim,
  };
};

const assertAuthorizedSequences = (
  locked: Awaited<ReturnType<typeof lockReceiptForPersistence>>,
  channel: ClaimSequenceChannel,
  sequences: number[],
): void => {
  const progress = getChannelProgress(locked.receipt, channel);
  const authorization: ReceiptSequenceAuthorization = {
    state: locked.state,
    start: progress.start,
    end: progress.end,
    emittedThrough: progress.emittedThrough,
    isCurrentClaim: locked.isCurrentClaim,
  };
  if (sequences.some((sequence) => !isReceiptSequenceAuthorized(authorization, sequence))) {
    throw new ClaimSequenceReceiptConflictError(
      `Durable ${channel} sequence is outside the authorized claim receipt`,
    );
  }
};

const groupByClaimAttempt = <T extends { claimAttemptId: string }>(
  values: T[],
): Array<[string, T[]]> => {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const claimAttemptId = value.claimAttemptId.trim();
    if (!claimAttemptId) throw new ClaimSequenceReceiptConflictError();
    const group = grouped.get(claimAttemptId) ?? [];
    group.push(value);
    grouped.set(claimAttemptId, group);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
};

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialize a legacy insert against the durable claim transaction.
 *
 * The claim path locks the same agent_jobs row before it calculates channel
 * high-water marks and creates its receipt. Therefore exactly one side wins:
 * a legacy insert that locks first is visible to the claim's MAX(), while a
 * claim that locks first leaves a receipt and permanently fences legacy input.
 */
const persistReceiptFreeLegacyRows = async <T>(
  jobId: string,
  persist: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> => db.transaction(async (tx) => {
  const [lockedJob] = await tx
    .select({
      id: agentJobs.id,
      currentClaimAttemptId: sql<string | null>`NULLIF(BTRIM(${agentJobs.config} ->> 'claimAttemptId'), '')`,
    })
    .from(agentJobs)
    .where(eq(agentJobs.id, jobId))
    .for("update");

  if (!lockedJob || lockedJob.currentClaimAttemptId !== null) {
    throw new ClaimSequenceReceiptConflictError(
      "Legacy sequence ingress is fenced by a durable claim",
    );
  }

  const [receipt] = await tx
    .select({ jobId: agentJobClaimSequenceReceipts.jobId })
    .from(agentJobClaimSequenceReceipts)
    .where(eq(agentJobClaimSequenceReceipts.jobId, jobId))
    .limit(1);
  if (receipt) {
    throw new ClaimSequenceReceiptConflictError(
      "Legacy sequence ingress is fenced by a durable receipt",
    );
  }

  return persist(tx);
});

export const persistReceiptFreeLegacyAgentJobLogs = async (
  logs: NewAgentJobLog[],
): Promise<(typeof agentJobLogs.$inferSelect)[]> => {
  if (logs.length === 0) return [];
  const jobId = logs[0]!.jobId;
  if (logs.some((log) => log.jobId !== jobId)) {
    throw new ClaimSequenceReceiptConflictError("Legacy log batch crosses jobs");
  }

  return persistReceiptFreeLegacyRows(jobId, (tx) => tx
    .insert(agentJobLogs)
    .values(logs)
    .onConflictDoNothing({ target: [agentJobLogs.jobId, agentJobLogs.seq] })
    .returning());
};

export const persistReceiptFreeLegacySessionEvents = async (
  events: NewSessionEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;
  const jobId = events[0]!.agentJobId;
  if (events.some((event) => event.agentJobId !== jobId)) {
    throw new ClaimSequenceReceiptConflictError(
      "Legacy session-event batch crosses jobs",
    );
  }

  return persistReceiptFreeLegacyRows(jobId, async (tx) => {
    const inserted = await tx
      .insert(sessionEvents)
      .values(events)
      .onConflictDoNothing({
        target: [sessionEvents.agentJobId, sessionEvents.sequenceNum],
        where: DURABLE_SESSION_EVENT_CONFLICT_PREDICATE,
      })
      .returning({ id: sessionEvents.id });
    return inserted.length;
  });
};

export const persistReceiptFreeLegacyNativeEvents = async (
  events: NewAgentNativeEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;
  const jobId = events[0]!.agentJobId;
  if (events.some((event) => event.agentJobId !== jobId)) {
    throw new ClaimSequenceReceiptConflictError(
      "Legacy native-event batch crosses jobs",
    );
  }

  return persistReceiptFreeLegacyRows(jobId, async (tx) => {
    const inserted = await tx
      .insert(agentNativeEvents)
      .values(events)
      .onConflictDoNothing({
        target: [agentNativeEvents.agentJobId, agentNativeEvents.sequenceNum],
      })
      .returning({ id: agentNativeEvents.id });
    return inserted.length;
  });
};

export type PersistFencedAgentJobLogsInput = Readonly<{
  jobId: string;
  workerId: string;
  claimAttemptId: string;
  logs: NewAgentJobLog[];
}>;

export const persistFencedAgentJobLogs = async (
  input: PersistFencedAgentJobLogsInput,
): Promise<(typeof agentJobLogs.$inferSelect)[]> => {
  if (input.logs.length === 0) return [];
  if (input.logs.some((log) => log.jobId !== input.jobId)) {
    throw new ClaimSequenceReceiptConflictError("Log batch crosses job receipts");
  }

  return db.transaction(async (tx) => {
    const locked = await lockReceiptForPersistence(tx, {
      jobId: input.jobId,
      claimAttemptId: input.claimAttemptId,
      expectedWorkerId: input.workerId,
    });
    assertAuthorizedSequences(
      locked,
      "jobLogs",
      input.logs.map((log) => log.seq),
    );

    const inserted = await tx.insert(agentJobLogs)
      .values(input.logs)
      .onConflictDoNothing({ target: [agentJobLogs.jobId, agentJobLogs.seq] })
      .returning();

    if (inserted.length > 0) {
      await tx.update(agentJobClaimSequenceReceipts)
        .set({
          jobLogInsertedCount:
            sql`${agentJobClaimSequenceReceipts.jobLogInsertedCount} + ${inserted.length}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentJobClaimSequenceReceipts.jobId, input.jobId),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, input.claimAttemptId),
          ),
        );
    }
    return inserted;
  });
};

export type FencedSessionEvent = Readonly<{
  claimAttemptId: string;
  event: NewSessionEvent;
}>;

export const persistFencedSessionEvents = async (
  values: FencedSessionEvent[],
): Promise<number> => {
  if (values.length === 0) return 0;
  const jobId = values[0]!.event.agentJobId;
  if (values.some(({ event }) => event.agentJobId !== jobId)) {
    throw new ClaimSequenceReceiptConflictError("Session-event batch crosses jobs");
  }

  return db.transaction(async (tx) => {
    let insertedTotal = 0;
    for (const [claimAttemptId, group] of groupByClaimAttempt(values)) {
      const locked = await lockReceiptForPersistence(tx, { jobId, claimAttemptId });
      assertAuthorizedSequences(
        locked,
        "sessionEvents",
        group.map(({ event }) => event.sequenceNum),
      );

      const deduplicated = [...new Map(
        group.map(({ event }) => [event.sequenceNum, event]),
      ).values()];
      const inserted = await tx.insert(sessionEvents)
        .values(deduplicated)
        .onConflictDoNothing({
          target: [sessionEvents.agentJobId, sessionEvents.sequenceNum],
          where: DURABLE_SESSION_EVENT_CONFLICT_PREDICATE,
        })
        .returning({ id: sessionEvents.id });

      if (inserted.length > 0) {
        await tx.update(agentJobClaimSequenceReceipts)
          .set({
            sessionEventInsertedCount:
              sql`${agentJobClaimSequenceReceipts.sessionEventInsertedCount} + ${inserted.length}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentJobClaimSequenceReceipts.jobId, jobId),
              eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
            ),
          );
      }
      insertedTotal += inserted.length;
    }
    return insertedTotal;
  });
};

export type FencedNativeEvent = Readonly<{
  claimAttemptId: string;
  event: NewAgentNativeEvent;
}>;

export const persistFencedNativeEvents = async (
  values: FencedNativeEvent[],
): Promise<number> => {
  if (values.length === 0) return 0;
  const jobId = values[0]!.event.agentJobId;
  if (values.some(({ event }) => event.agentJobId !== jobId)) {
    throw new ClaimSequenceReceiptConflictError("Native-event batch crosses jobs");
  }

  return db.transaction(async (tx) => {
    let insertedTotal = 0;
    for (const [claimAttemptId, group] of groupByClaimAttempt(values)) {
      const locked = await lockReceiptForPersistence(tx, { jobId, claimAttemptId });
      assertAuthorizedSequences(
        locked,
        "nativeEvents",
        group.map(({ event }) => event.sequenceNum),
      );

      const inserted = await tx.insert(agentNativeEvents)
        .values(group.map(({ event }) => event))
        .onConflictDoNothing({
          target: [agentNativeEvents.agentJobId, agentNativeEvents.sequenceNum],
        })
        .returning({ id: agentNativeEvents.id });

      if (inserted.length > 0) {
        await tx.update(agentJobClaimSequenceReceipts)
          .set({
            nativeEventInsertedCount:
              sql`${agentJobClaimSequenceReceipts.nativeEventInsertedCount} + ${inserted.length}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentJobClaimSequenceReceipts.jobId, jobId),
              eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
            ),
          );
      }
      insertedTotal += inserted.length;
    }
    return insertedTotal;
  });
};

export type EnsureClaimSequenceReservationInput = Readonly<{
  jobId: string;
  workerId: string;
  claimAttemptId: string;
  channel: ClaimSequenceChannel;
  requiredThrough: number;
}>;

export const ensureClaimSequenceReservation = async (
  input: EnsureClaimSequenceReservationInput,
): Promise<{ reservedThrough: number }> => {
  if (
    !Number.isInteger(input.requiredThrough) ||
    input.requiredThrough < 0 ||
    input.requiredThrough > MAX_DURABLE_SEQUENCE
  ) {
    throw new Error("Invalid required durable sequence");
  }

  return db.transaction(async (tx) => {
    const receipt = await lockCurrentReceipt(tx, input);
    if (receipt.state !== "active") {
      throw new ClaimSequenceReceiptConflictError("Claim receipt is already draining");
    }

    const progress = getChannelProgress(receipt, input.channel);
    if (input.requiredThrough < progress.start) {
      return { reservedThrough: progress.end };
    }
    const reservedThrough = calculateSequenceReservationEnd(
      progress.end,
      input.requiredThrough,
    );

    if (reservedThrough !== progress.end) {
      await tx
        .update(agentJobClaimSequenceReceipts)
        .set({
          ...getReservationEndPatch(input.channel, reservedThrough),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentJobClaimSequenceReceipts.jobId, input.jobId),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, input.claimAttemptId),
            eq(agentJobClaimSequenceReceipts.state, "active"),
          ),
        );
    }

    return { reservedThrough };
  });
};

export type ClaimSequenceHighWater = Readonly<{
  protocolVersion: 2;
  jobLogs: number;
  sessionEvents: number;
  nativeEvents: number;
}>;

export type PrepareClaimSequenceHandoffInput = Readonly<{
  jobId: string;
  workerId: string;
  claimAttemptId: string;
  emittedThrough: ClaimSequenceHighWater;
}>;

export type ClaimSequenceHandoffResult = Readonly<{
  ready: boolean;
  insertedCount: {
    jobLogs: number;
    sessionEvents: number;
    nativeEvents: number;
  };
  expectedCount: {
    jobLogs: number;
    sessionEvents: number;
    nativeEvents: number;
  };
}>;

export const prepareClaimSequenceHandoff = async (
  input: PrepareClaimSequenceHandoffInput,
): Promise<ClaimSequenceHandoffResult> => {
  if (
    input.emittedThrough.protocolVersion !== 2 ||
    ![
      input.emittedThrough.jobLogs,
      input.emittedThrough.sessionEvents,
      input.emittedThrough.nativeEvents,
    ].every(
      (value) =>
        Number.isInteger(value) && value >= 0 && value <= MAX_DURABLE_SEQUENCE,
    )
  ) {
    throw new Error("Invalid producer sequence high-water mark");
  }

  return db.transaction(async (tx) => {
    const receipt = await lockCurrentReceipt(tx, input);
    if (!(["active", "draining", "ready"] as ClaimSequenceReceiptState[]).includes(receipt.state)) {
      throw new ClaimSequenceReceiptConflictError();
    }

    const channels = {
      jobLogs: getChannelProgress(receipt, "jobLogs"),
      sessionEvents: getChannelProgress(receipt, "sessionEvents"),
      nativeEvents: getChannelProgress(receipt, "nativeEvents"),
    };
    const emittedThrough = input.emittedThrough;

    for (const [channel, progress] of Object.entries(channels) as Array<
      [keyof typeof channels, (typeof channels)[keyof typeof channels]]
    >) {
      const emitted = emittedThrough[channel];
      if (emitted < progress.start - 1 || emitted > progress.end) {
        throw new ClaimSequenceReceiptConflictError(
          `Emitted ${channel} sequence is outside the reserved range`,
        );
      }
      if (progress.emittedThrough !== null && progress.emittedThrough !== emitted) {
        throw new ClaimSequenceReceiptConflictError(
          `Emitted ${channel} sequence changed after drain intent`,
        );
      }
    }

    const expectedCount = {
      jobLogs: calculateExpectedInsertedCount(
        channels.jobLogs.start,
        emittedThrough.jobLogs,
      ),
      sessionEvents: calculateExpectedInsertedCount(
        channels.sessionEvents.start,
        emittedThrough.sessionEvents,
      ),
      nativeEvents: calculateExpectedInsertedCount(
        channels.nativeEvents.start,
        emittedThrough.nativeEvents,
      ),
    };
    const insertedCount = {
      jobLogs: channels.jobLogs.insertedCount,
      sessionEvents: channels.sessionEvents.insertedCount,
      nativeEvents: channels.nativeEvents.insertedCount,
    };

    if (
      insertedCount.jobLogs > expectedCount.jobLogs ||
      insertedCount.sessionEvents > expectedCount.sessionEvents ||
      insertedCount.nativeEvents > expectedCount.nativeEvents
    ) {
      throw new ClaimSequenceReceiptConflictError(
        "Persisted sequence count exceeds the producer handoff",
      );
    }

    const ready =
      insertedCount.jobLogs === expectedCount.jobLogs &&
      insertedCount.sessionEvents === expectedCount.sessionEvents &&
      insertedCount.nativeEvents === expectedCount.nativeEvents;

    await tx
      .update(agentJobClaimSequenceReceipts)
      .set({
        state: ready ? "ready" : "draining",
        jobLogEmittedThrough: emittedThrough.jobLogs,
        sessionEventEmittedThrough: emittedThrough.sessionEvents,
        nativeEventEmittedThrough: emittedThrough.nativeEvents,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentJobClaimSequenceReceipts.jobId, input.jobId),
          eq(agentJobClaimSequenceReceipts.claimAttemptId, input.claimAttemptId),
          inArray(agentJobClaimSequenceReceipts.state, ["active", "draining", "ready"]),
        ),
      );

    return { ready, insertedCount, expectedCount };
  });
};
