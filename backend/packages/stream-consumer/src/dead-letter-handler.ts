import type Redis from "ioredis";
import type { AgentOutputEvent } from "./types";
import { DEFAULT_DLQ_STREAM_NAME } from "./types";

// ---------------------------------------------------------------------------
// DeadLetterHandler — moves permanently-failed events to a DLQ stream
// ---------------------------------------------------------------------------

export type DeadLetterHandler = {
  moveToDlq: (
    event: AgentOutputEvent,
    error: string,
    retryCount: number,
    consumerGroup: string
  ) => Promise<void>;
  trim: () => Promise<void>;
};

const DLQ_MAX_LEN = 10_000;

export const createDeadLetterHandler = (
  redis: Redis,
  dlqStreamName: string = DEFAULT_DLQ_STREAM_NAME
): DeadLetterHandler => {
  const moveToDlq = async (
    event: AgentOutputEvent,
    error: string,
    retryCount: number,
    consumerGroup: string
  ): Promise<void> => {
    await redis.xadd(
      dlqStreamName,
      "*",
      "originalEvent",
      JSON.stringify(event),
      "error",
      error,
      "retryCount",
      String(retryCount),
      "failedAt",
      new Date().toISOString(),
      "consumerGroup",
      consumerGroup
    );
  };

  const trim = async (): Promise<void> => {
    await redis.xtrim(dlqStreamName, "MAXLEN", "~", DLQ_MAX_LEN);
  };

  return { moveToDlq, trim };
};
