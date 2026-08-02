import { describe, expect, test } from "bun:test";
import type Redis from "ioredis";
import {
  createDeadLetterHandler,
  DLQ_QUARANTINE_SCRIPT,
} from "../dead-letter-handler";
import { createStreamCleaner } from "../stream-cleaner";
import type { AgentOutputEvent } from "../types";

const event: AgentOutputEvent = {
  jobId: "job-poison",
  sessionId: "session-poison",
  workspaceId: "workspace-poison",
  threadId: "thread-poison",
  timestamp: 1,
  sequenceNumber: 7,
  sequenceProtocolVersion: "durable.v2",
  claimAttemptId: "attempt-poison",
  type: "message",
  content: "poison",
};

describe("lossless stream retention", () => {
  test("cleaner trims only before the oldest all-group safe frontier", async () => {
    const xtrimCalls: unknown[][] = [];
    const redis = {
      xinfo: async () => [
        [
          "name", "web-bridge",
          "consumers", 1,
          "pending", 0,
          "last-delivered-id", "200-0",
        ],
        [
          "name", "discord-bridge",
          "consumers", 1,
          "pending", 2,
          "last-delivered-id", "300-0",
        ],
      ],
      xpending: async (
        _stream: string,
        group: string,
      ) => group === "discord-bridge"
        ? [["150-0", "discord-1", 1_000, 1]]
        : [],
      xtrim: async (...args: unknown[]) => {
        xtrimCalls.push(args);
        return 42;
      },
    } as unknown as Redis;
    const cleaner = createStreamCleaner(redis, {
      streamName: "durable-stream",
    });

    const removed = await cleaner.cleanNow();

    expect(removed).toBe(42);
    expect(xtrimCalls).toEqual([
      ["durable-stream", "MINID", "=", "150-0"],
    ]);
  });

  test("cleaner fails closed when a pending frontier cannot be proven", async () => {
    const xtrimCalls: unknown[][] = [];
    const redis = {
      xinfo: async () => [[
        "name", "web-bridge",
        "pending", 1,
        "last-delivered-id", "200-0",
      ]],
      xpending: async () => [],
      xtrim: async (...args: unknown[]) => {
        xtrimCalls.push(args);
        return 1;
      },
    } as unknown as Redis;
    const cleaner = createStreamCleaner(redis, {
      streamName: "durable-stream",
    });

    const removed = await cleaner.cleanNow();

    expect(removed).toBe(0);
    expect(xtrimCalls).toEqual([]);
  });

  test("cleaner does nothing when no consumer group protects the stream", async () => {
    const xtrimCalls: unknown[][] = [];
    const redis = {
      xinfo: async () => [],
      xtrim: async (...args: unknown[]) => {
        xtrimCalls.push(args);
        return 1;
      },
    } as unknown as Redis;
    const cleaner = createStreamCleaner(redis, {
      streamName: "durable-stream",
    });

    const removed = await cleaner.cleanNow();

    expect(removed).toBe(0);
    expect(xtrimCalls).toEqual([]);
  });

  test("start performs an immediate safe cleanup", async () => {
    const xtrimCalls: unknown[][] = [];
    const redis = {
      xinfo: async () => [[
        "name", "web-bridge",
        "pending", 0,
        "last-delivered-id", "200-0",
      ]],
      xtrim: async (...args: unknown[]) => {
        xtrimCalls.push(args);
        return 1;
      },
    } as unknown as Redis;
    const cleaner = createStreamCleaner(redis, {
      streamName: "durable-stream",
      intervalMs: 60_000,
    });

    cleaner.start();
    await Bun.sleep(1);
    cleaner.stop();

    expect(xtrimCalls).toEqual([
      ["durable-stream", "MINID", "=", "200-0"],
    ]);
  });

  test("DLQ trim is intentionally non-destructive", async () => {
    const xtrimCalls: unknown[][] = [];
    const redis = {
      xtrim: async (...args: unknown[]) => {
        xtrimCalls.push(args);
        return 0;
      },
    } as unknown as Redis;
    const dlq = createDeadLetterHandler(redis, "durable-dlq");

    await dlq.trim();

    expect(xtrimCalls).toEqual([]);
  });
});

describe("atomic idempotent quarantine", () => {
  test("two consumers racing the same poison entry create one DLQ row then ACK", async () => {
    const index = new Map<string, string>();
    const dlqRows: Array<Record<string, string>> = [];
    const acknowledged = new Set<string>();
    const redis = {
      eval: async (
        script: string,
        keyCount: number,
        dlqStream: string,
        indexKey: string,
        sourceStream: string,
        marker: string,
        originalEvent: string,
        originalFields: string,
        error: string,
        retryCount: string,
        failedAt: string,
        consumerGroup: string,
        entryId: string,
      ) => {
        expect(script).toBe(DLQ_QUARANTINE_SCRIPT);
        expect(keyCount).toBe(3);
        expect([dlqStream, indexKey, sourceStream]).toEqual([
          "durable-dlq",
          "durable-dlq:quarantine-index",
          "durable-stream",
        ]);

        let dlqEntryId = index.get(marker);
        let inserted = 0;
        if (!dlqEntryId) {
          dlqEntryId = `${dlqRows.length + 1}-0`;
          index.set(marker, dlqEntryId);
          dlqRows.push({
            originalEvent,
            originalFields,
            error,
            retryCount,
            failedAt,
            consumerGroup,
            sourceEntryId: entryId,
          });
          inserted = 1;
        }
        acknowledged.add(`${consumerGroup}:${entryId}`);
        return [dlqEntryId, inserted, 1];
      },
    } as unknown as Redis;
    const dlq = createDeadLetterHandler(redis, "durable-dlq");
    const source = {
      sourceStream: "durable-stream",
      entryId: "1710000000000-0",
      originalFields: ["jobId", "job-poison", "content", "poison"],
    };

    const [first, second] = await Promise.all([
      dlq.moveToDlq(event, "HTTP 409", 1, "web", source),
      dlq.moveToDlq(event, "HTTP 409", 1, "web", source),
    ]);

    expect(first.dlqEntryId).toBe(second.dlqEntryId);
    expect(dlqRows).toHaveLength(1);
    expect(JSON.parse(dlqRows[0]!.originalEvent)).toEqual(event);
    expect(JSON.parse(dlqRows[0]!.originalFields)).toEqual(
      source.originalFields,
    );
    expect(acknowledged).toEqual(new Set(["web:1710000000000-0"]));
  });
});
