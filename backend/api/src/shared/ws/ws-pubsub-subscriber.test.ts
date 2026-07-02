import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

type MessageHandler = (channel: string, rawMessage: string) => void;

const redisState = {
  subscribedChannel: null as string | null,
  unsubscribedChannel: null as string | null,
  quitCalls: 0,
  messageHandler: null as MessageHandler | null,
};

class MockRedis {
  constructor(_url: string) {}

  subscribe(channel: string, callback?: (err: Error | null) => void) {
    redisState.subscribedChannel = channel;
    callback?.(null);
    return Promise.resolve(1);
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    if (event === "message") {
      redisState.messageHandler = handler as MessageHandler;
    }
    return this;
  }

  unsubscribe(channel: string) {
    redisState.unsubscribedChannel = channel;
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

const broadcastLocallyToWorkspace = mock(() => {});
const getInstanceId = mock(() => "instance-a");

mock.module("ioredis", () => ({
  default: MockRedis,
}));

mock.module("@almirant/config", () => ({
  logger,
}));

mock.module("./ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastLocallyToWorkspace,
    getInstanceId,
  },
}));

let startWsPubSubSubscriber: Awaited<
  typeof import("./ws-pubsub-subscriber")
>["startWsPubSubSubscriber"];

beforeAll(async () => {
  ({ startWsPubSubSubscriber } = await import("./ws-pubsub-subscriber"));
});

afterEach(() => {
  redisState.subscribedChannel = null;
  redisState.unsubscribedChannel = null;
  redisState.quitCalls = 0;
  redisState.messageHandler = null;
  logger.error.mockClear();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.debug.mockClear();
  broadcastLocallyToWorkspace.mockClear();
  getInstanceId.mockClear();
});

describe("startWsPubSubSubscriber", () => {
  it("re-broadcasts messages from other instances and ignores self-originated ones", async () => {
    const stop = startWsPubSubSubscriber({
      redisUrl: "redis://test",
      channel: "ws:broadcast",
    });

    expect(redisState.subscribedChannel).toBe("ws:broadcast");
    expect(redisState.messageHandler).not.toBeNull();

    redisState.messageHandler?.(
      "ws:broadcast",
      JSON.stringify({
        workspaceId: "org-1",
        message: { type: "agent-job:status-changed", payload: { jobId: "job-1" } },
        originInstanceId: "instance-b",
      })
    );

    expect(broadcastLocallyToWorkspace).toHaveBeenCalledTimes(1);
    expect(broadcastLocallyToWorkspace).toHaveBeenCalledWith("org-1", {
      type: "agent-job:status-changed",
      payload: { jobId: "job-1" },
    });

    redisState.messageHandler?.(
      "ws:broadcast",
      JSON.stringify({
        workspaceId: "org-1",
        message: { type: "agent-job:status-changed", payload: { jobId: "job-2" } },
        originInstanceId: "instance-a",
      })
    );

    expect(broadcastLocallyToWorkspace).toHaveBeenCalledTimes(1);

    await stop();

    expect(redisState.unsubscribedChannel).toBe("ws:broadcast");
    expect(redisState.quitCalls).toBe(1);
  });
});
