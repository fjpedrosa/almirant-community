import { sql, type SQL } from "drizzle-orm";
import { db } from "../../client";

export const QUEUED_RECEIPT_RESIDUE_ERROR_TYPE =
  "DURABLE_SEQUENCE_RECEIPT_RESIDUE_REQUIRES_FRESH_DISPATCH";
export const QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE =
  "This queued job contains durable sequence receipt residue and cannot be safely resumed while durable receipts are disabled. Dispatch a fresh job.";

export interface QueuedReceiptResidueCandidate {
  jobId: string;
  /**
   * A fixed UTC PostgreSQL rendering is retained instead of a JavaScript Date
   * so the CAS loses neither sub-millisecond precision nor session-time-zone
   * stability.
   */
  updatedAtMarker: string;
  /** Exact JSONB text markers selected from the immutable candidate snapshot. */
  claimAttemptMarker: string;
  sequenceHighWaterMarker: string;
  /**
   * Exact JSONB snapshot of every receipt row. This fences receipt insertion,
   * deletion, state/progress changes, and reservation changes after selection.
   */
  receiptMarker: string;
}

export type QueuedReceiptResidueQueryExecutor = <T>(
  query: SQL<T>,
) => Promise<T[]>;

const defaultExecute: QueuedReceiptResidueQueryExecutor = async <T>(
  query: SQL<T>,
): Promise<T[]> => Array.from(await db.execute(query)) as T[];

const clampBatchSize = (value: number): number =>
  Math.min(Math.max(Math.trunc(value), 1), 100);

/**
 * Canonical receipt snapshot shared by selection and CAS. Timestamps are
 * rendered at UTC microsecond precision because to_jsonb(timestamptz) follows
 * the current database session time zone.
 */
const receiptMarkerSql = sql`
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'jobId', receipt.job_id,
          'claimAttemptId', receipt.claim_attempt_id,
          'workerId', receipt.worker_id,
          'state', receipt.state,
          'jobLogSequenceStart', receipt.job_log_sequence_start,
          'jobLogSequenceEnd', receipt.job_log_sequence_end,
          'jobLogEmittedThrough', receipt.job_log_emitted_through,
          'jobLogInsertedCount', receipt.job_log_inserted_count,
          'sessionEventSequenceStart', receipt.session_event_sequence_start,
          'sessionEventSequenceEnd', receipt.session_event_sequence_end,
          'sessionEventEmittedThrough', receipt.session_event_emitted_through,
          'sessionEventInsertedCount', receipt.session_event_inserted_count,
          'nativeEventSequenceStart', receipt.native_event_sequence_start,
          'nativeEventSequenceEnd', receipt.native_event_sequence_end,
          'nativeEventEmittedThrough', receipt.native_event_emitted_through,
          'nativeEventInsertedCount', receipt.native_event_inserted_count,
          'createdAt', to_char(
            receipt.created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'updatedAt', to_char(
            receipt.updated_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'finalizedAt', to_char(
            receipt.finalized_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        )
        ORDER BY receipt.claim_attempt_id
      )
      FROM agent_job_claim_sequence_receipts receipt
      WHERE receipt.job_id = job.id
    ),
    '[]'::jsonb
  )::text
`;

/**
 * Returns only old, stable, workerless queued jobs that cannot be consumed by
 * the legacy receipt-free claim path. Nothing is locked or mutated here; the
 * exact snapshot is revalidated by failQueuedReceiptResidueCandidate.
 */
export const findQueuedReceiptResidueCandidates = async (
  input: {
    updatedBefore: Date;
    limit: number;
  },
  execute: QueuedReceiptResidueQueryExecutor = defaultExecute,
): Promise<QueuedReceiptResidueCandidate[]> =>
  execute<QueuedReceiptResidueCandidate>(sql`
    SELECT
      job.id AS "jobId",
      to_char(
        job.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "updatedAtMarker",
      COALESCE(
        job.config -> 'claimAttemptId',
        'null'::jsonb
      )::text AS "claimAttemptMarker",
      COALESCE(
        job.config -> 'sequenceHighWater',
        'null'::jsonb
      )::text AS "sequenceHighWaterMarker",
      ${receiptMarkerSql} AS "receiptMarker"
    FROM agent_jobs job
    WHERE job.status = 'queued'
      AND job.worker_id IS NULL
      AND job.created_at <= ${input.updatedBefore}
      AND job.updated_at <= ${input.updatedBefore}
      AND NOT EXISTS (
        SELECT 1
        FROM agent_job_claim_sequence_receipts unstable_receipt
        WHERE unstable_receipt.job_id = job.id
          AND (
            unstable_receipt.created_at > ${input.updatedBefore}
            OR unstable_receipt.updated_at > ${input.updatedBefore}
          )
      )
      AND (
        COALESCE(job.config ->> 'claimAttemptId', '') <> ''
        OR job.config #>> '{sequenceHighWater,protocolVersion}' = '2'
        OR EXISTS (
          SELECT 1
          FROM agent_job_claim_sequence_receipts receipt
          WHERE receipt.job_id = job.id
        )
      )
    ORDER BY job.updated_at ASC, job.id ASC
    LIMIT ${clampBatchSize(input.limit)}
  `);

/**
 * Fail-closed terminal transition for one selected residue candidate.
 *
 * Every mutable eligibility field and every receipt row is fenced against the
 * selection snapshot. A concurrent claim, job touch, or marker change returns
 * zero rows. Sequence high-water values and receipt reservations are NEVER
 * cleared or reused.
 */
export const failQueuedReceiptResidueCandidate = async (
  candidate: QueuedReceiptResidueCandidate,
  input: {
    updatedBefore: Date;
    failedAt: Date;
  },
  execute: QueuedReceiptResidueQueryExecutor = defaultExecute,
): Promise<boolean> => {
  const result = {
    summary: QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE,
    filesChanged: [] as string[],
    linesAdded: 0,
    linesRemoved: 0,
  };
  const rows = await execute<{ jobId: string }>(sql`
    UPDATE agent_jobs AS job
    SET
      status = 'failed',
      result = ${JSON.stringify(result)}::jsonb,
      failed_at = ${input.failedAt},
      error_type = ${QUEUED_RECEIPT_RESIDUE_ERROR_TYPE},
      error_message = ${QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE},
      updated_at = ${input.failedAt}
    WHERE job.id = ${candidate.jobId}
      AND job.status = 'queued'
      AND job.worker_id IS NULL
      AND job.created_at <= ${input.updatedBefore}
      AND job.updated_at <= ${input.updatedBefore}
      AND NOT EXISTS (
        SELECT 1
        FROM agent_job_claim_sequence_receipts unstable_receipt
        WHERE unstable_receipt.job_id = job.id
          AND (
            unstable_receipt.created_at > ${input.updatedBefore}
            OR unstable_receipt.updated_at > ${input.updatedBefore}
          )
      )
      AND to_char(
        job.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) = ${candidate.updatedAtMarker}
      AND COALESCE(
        job.config -> 'claimAttemptId',
        'null'::jsonb
      )::text = ${candidate.claimAttemptMarker}
      AND COALESCE(
        job.config -> 'sequenceHighWater',
        'null'::jsonb
      )::text = ${candidate.sequenceHighWaterMarker}
      AND ${receiptMarkerSql} = ${candidate.receiptMarker}
      AND (
        COALESCE(job.config ->> 'claimAttemptId', '') <> ''
        OR job.config #>> '{sequenceHighWater,protocolVersion}' = '2'
        OR EXISTS (
          SELECT 1
          FROM agent_job_claim_sequence_receipts receipt
          WHERE receipt.job_id = job.id
        )
      )
    RETURNING job.id AS "jobId"
  `);
  return rows.length === 1;
};
