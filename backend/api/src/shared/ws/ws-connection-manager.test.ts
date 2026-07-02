import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createWsConnectionManager } from "./ws-connection-manager.impl";

const redisState = {
  publishCalls: [] as Array<{ channel: string; payload: string }>,
  quitCalls: 0,
};

class MockRedis {
  constructor(_url: string) {}

  on(_event: string, _handler: (...args: unknown[]) => void) {
    return this;
  }

  publish(channel: string, payload: string) {
    redisState.publishCalls.push({ channel, payload });
    return Promise.resolve(1);
  }

  quit() {
    redisState.quitCalls += 1;
    return Promise.resolve("OK");
  }
}

const logger = {
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  debug: mock(() => {}),
};

let wsConnectionManager: ReturnType<typeof createWsConnectionManager>;

beforeEach(() => {
  redisState.publishCalls = [];
  redisState.quitCalls = 0;
  logger.error.mockClear();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.debug.mockClear();

  wsConnectionManager = createWsConnectionManager({
    RedisClass: MockRedis as unknown as new (url: string) => {
      on: (event: string, handler: (...args: unknown[]) => void) => unknown;
      publish: (channel: string, payload: string) => Promise<unknown>;
      quit: () => Promise<unknown>;
    },
    env: {
      REDIS_URL: "redis://test",
      WS_PUBSUB_CHANNEL: "ws:broadcast",
    },
    logger,
    instanceId: "instance-test",
  });
});

afterEach(async () => {
  await wsConnectionManager.stopPubSubPublisher();
});

describe("wsConnectionManager.broadcastToWorkspace", () => {
  it("broadcasts locally and publishes to Redis Pub/Sub for other instances", async () => {
    const sent: string[] = [];
    const ws = {
      send: (payload: string | Buffer) => {
        sent.push(String(payload));
      },
      close: () => {},
    };

    wsConnectionManager.addConnection("user-1", ws, "org-1");

    const message = {
      type: "agent-job:status-changed",
      payload: {
        jobId: "job-1",
        status: "queued",
        workItemId: null,
        planningSessionId: null,
      },
    } as const;

    wsConnectionManager.broadcastToWorkspace("org-1", message);

    await Promise.resolve();

    expect(sent).toEqual([JSON.stringify(message)]);
    expect(redisState.publishCalls).toHaveLength(1);
    expect(redisState.publishCalls[0]?.channel).toBe("ws:broadcast");

    const published = JSON.parse(redisState.publishCalls[0]!.payload) as {
      workspaceId: string;
      message: typeof message;
      originInstanceId?: string;
    };

    expect(published.workspaceId).toBe("org-1");
    expect(published.message).toEqual(message);
    expect(published.originInstanceId).toBe("instance-test");

    wsConnectionManager.removeConnection("user-1", ws);
  });
});
