import type Redis from "ioredis";
import type { AgentOutputEvent } from "./types";
import { DEFAULT_DLQ_STREAM_NAME } from "./types";

// ---------------------------------------------------------------------------
// DeadLetterHandler — atomically quarantines permanently-failed events
// ---------------------------------------------------------------------------

export type DeadLetterSource = {
  sourceStream: string;
  entryId: string;
  /** Exact Redis field/value array, retained in addition to the parsed event. */
  originalFields: string[];
};

export type DeadLetterResult = {
  dlqEntryId: string;
  inserted: boolean;
  acknowledged: number;
};

export type DeadLetterHandler = {
  moveToDlq: (
    event: AgentOutputEvent,
    error: string,
    retryCount: number,
    consumerGroup: string,
    source: DeadLetterSource,
  ) => Promise<DeadLetterResult>;
  /** Retained for API compatibility; intentionally does not delete evidence. */
  trim: () => Promise<void>;
};

/**
 * One Redis transaction for the quarantine boundary.
 *
 * The hash is a permanent idempotency index keyed by (group, streamEntryId).
 * XADD and HSET happen before XACK in the same Lua invocation. If any command
 * fails, Redis aborts the script and the source remains pending.
 */
export const DLQ_QUARANTINE_SCRIPT = `
local existing = redis.call("HGET", KEYS[2], ARGV[1])
local inserted = 0
if not existing then
  existing = redis.call(
    "XADD", KEYS[1], "*",
    "quarantineKey", ARGV[1],
    "originalEvent", ARGV[2],
    "originalFields", ARGV[3],
    "error", ARGV[4],
    "retryCount", ARGV[5],
    "failedAt", ARGV[6],
    "consumerGroup", ARGV[7],
    "sourceEntryId", ARGV[8]
  )
  redis.call("HSET", KEYS[2], ARGV[1], existing)
  inserted = 1
end
local acknowledged = redis.call("XACK", KEYS[3], ARGV[7], ARGV[8])
return { existing, inserted, acknowledged }
`;

export const createDeadLetterHandler = (
  redis: Redis,
  dlqStreamName: string = DEFAULT_DLQ_STREAM_NAME,
): DeadLetterHandler => {
  const quarantineIndexKey = `${dlqStreamName}:quarantine-index`;

  const moveToDlq = async (
    event: AgentOutputEvent,
    error: string,
    retryCount: number,
    consumerGroup: string,
    source: DeadLetterSource,
  ): Promise<DeadLetterResult> => {
    const marker = JSON.stringify([consumerGroup, source.entryId]);
    const result = await redis.eval(
      DLQ_QUARANTINE_SCRIPT,
      3,
      dlqStreamName,
      quarantineIndexKey,
      source.sourceStream,
      marker,
      JSON.stringify(event),
      JSON.stringify(source.originalFields),
      error,
      String(retryCount),
      new Date().toISOString(),
      consumerGroup,
      source.entryId,
    );

    if (!Array.isArray(result) || result.length < 3) {
      throw new Error("Invalid Redis quarantine response");
    }

    return {
      dlqEntryId: String(result[0]),
      inserted: Number(result[1]) === 1,
      acknowledged: Number(result[2]),
    };
  };

  const trim = async (): Promise<void> => {
    // Deliberately non-destructive. A poison record is operational evidence;
    // MAXLEN 10k can silently erase the only copy during a sustained incident.
  };

  return { moveToDlq, trim };
};
