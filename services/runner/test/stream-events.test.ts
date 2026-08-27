import { describe, it, expect, jest } from "bun:test";
import type {
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  AgentOutputEvent,
  StreamPublisher,
} from "@almirant/stream-consumer";
import {
  createStreamChannelAdapter,
  createSequencedStreamPublisher,
  getCurrentStreamSequenceHighWater,
  StreamPublishCapacityError,
  StreamPublishTimeoutError,
  nextNativeSequence,
  nextSequence,
  publishCanonicalEvent,
  publishJobStarted,
  publishStreamEvent,
  runWithStreamSequenceBases,
} from "../src/session/stream-events";

const canonicalEnvelope = (sequenceNumber = nextSequence()): CanonicalEventEnvelope => ({
  jobId: "job-1",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  threadId: "thread-1",
  timestamp: Date.now(),
  sequenceNumber,
  event: { kind: "system.info", message: "test" },
});

// ---------------------------------------------------------------------------
// A minimal in-memory StreamPublisher that records canonical envelopes.
// ---------------------------------------------------------------------------

const createRecordingPublisher = (): {
  publisher: StreamPublisher;
  canonical: CanonicalEventEnvelope[];
} => {
  const canonical: CanonicalEventEnvelope[] = [];
  const publisher: StreamPublisher = {
    publish: async (_event: AgentOutputEvent) => "0-0",
    publishCanonicalEnvelope: async (envelope: CanonicalEventEnvelope) => {
      canonical.push(envelope);
      return "0-0";
    },
    publishNativeEnvelope: async (_envelope: NativeEventEnvelope) => "0-0",
    close: async () => {},
  };
  return { publisher, canonical };
};

describe("publishJobStarted", () => {
  it("emits a canonical job.started envelope at the start of an attempt", async () => {
    const { publisher, canonical } = createRecordingPublisher();

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0, claimAttemptId: "attempt-42" },
      () => publishJobStarted(publisher, {
        jobId: "job-42",
        sessionId: "session-42",
        workspaceId: "org-42",
        threadId: "thread-42",
      }),
    );

    expect(canonical.length).toBe(1);
    const env = canonical[0]!;
    expect(env.event.kind).toBe("job.started");
    expect(env.jobId).toBe("job-42");
    expect(env.sessionId).toBe("session-42");
    expect(env.workspaceId).toBe("org-42");
    expect(env.threadId).toBe("thread-42");
    expect(typeof env.sequenceNumber).toBe("number");
    expect(env.sequenceProtocolVersion).toBe("durable.v2");
    expect(env.claimAttemptId).toBe("attempt-42");
  });

  it("forwards optional model/branch metadata onto the job.started event", async () => {
    const { publisher, canonical } = createRecordingPublisher();

    await publishJobStarted(publisher, {
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "org-1",
      threadId: "thread-1",
      model: "claude-opus",
      branch: "feature/foo",
    });

    const env = canonical[0]!;
    if (env.event.kind !== "job.started") throw new Error("expected job.started");
    expect(env.event.model).toBe("claude-opus");
    expect(env.event.branch).toBe("feature/foo");
  });

  it("is a no-op when no publisher is configured (redis disabled)", async () => {
    // Must not throw when streamPublisher is undefined.
    await publishJobStarted(undefined, {
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "org-1",
      threadId: "thread-1",
    });
    expect(typeof nextSequence()).toBe("number");
  });
});

describe("durable per-execution stream sequences", () => {
  it("starts canonical and native sequences at their durable base plus one", async () => {
    const observed = await runWithStreamSequenceBases(
      { canonical: 40, native: 90 },
      async () => ({
        canonical: [nextSequence(), nextSequence()],
        native: [nextNativeSequence(), nextNativeSequence()],
      }),
    );

    expect(observed).toEqual({
      canonical: [41, 42],
      native: [91, 92],
    });
  });

  it("does not report merely allocated sequence numbers as emitted high-water marks", async () => {
    const highWater = await runWithStreamSequenceBases(
      { canonical: 40, native: 90 },
      async () => {
        nextSequence();
        nextSequence();
        nextNativeSequence();
        return getCurrentStreamSequenceHighWater();
      },
    );

    expect(highWater).toEqual({ canonical: 40, native: 90 });
  });

  it("isolates concurrent job executions instead of sharing a process-global counter", async () => {
    const [first, second] = await Promise.all([
      runWithStreamSequenceBases({ canonical: 10, native: 20 }, async () => {
        const start = nextSequence();
        await Promise.resolve();
        return [start, nextSequence(), nextNativeSequence()];
      }),
      runWithStreamSequenceBases({ canonical: 100, native: 200 }, async () => {
        const start = nextSequence();
        await Promise.resolve();
        return [start, nextSequence(), nextNativeSequence()];
      }),
    ]);

    expect(first).toEqual([11, 12, 21]);
    expect(second).toEqual([101, 102, 201]);
  });

  it("appends monotonically across three same-job cooldown executions", async () => {
    let canonicalBase = 0;
    let nativeBase = 0;
    const canonical: number[] = [];
    const native: number[] = [];

    for (let execution = 0; execution < 3; execution += 1) {
      const emitted = await runWithStreamSequenceBases(
        { canonical: canonicalBase, native: nativeBase },
        async () => ({
          canonical: [nextSequence(), nextSequence()],
          native: [nextNativeSequence()],
        }),
      );
      canonical.push(...emitted.canonical);
      native.push(...emitted.native);
      canonicalBase = emitted.canonical.at(-1)!;
      nativeBase = emitted.native.at(-1)!;
    }

    expect(canonical).toEqual([1, 2, 3, 4, 5, 6]);
    expect(native).toEqual([1, 2, 3]);
  });

  it("retries the same canonical sequence and advances high-water only after XADD succeeds", async () => {
    const attemptedSequences: number[] = [];
    let attempt = 0;
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (envelope) => {
        attemptedSequences.push(envelope.sequenceNumber);
        attempt += 1;
        if (attempt === 1) throw new Error("redis unavailable");
        return "1-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    const highWater = await runWithStreamSequenceBases(
      {
        canonical: 10,
        native: 20,
        canonicalEnd: 4_106,
        nativeEnd: 4_116,
        claimAttemptId: "attempt-1",
        ensureReservation: async () => 8_202,
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        await publishCanonicalEvent(publisher, canonicalEnvelope());
        const emitted = getCurrentStreamSequenceHighWater();
        await publisher.close();
        return emitted;
      },
    );

    expect(attemptedSequences).toEqual([11, 11]);
    expect(highWater).toEqual({ canonical: 11, native: 20 });
  });

  it("latches a persistent XADD failure, preserves high-water, and rejects close", async () => {
    const attemptedSequences: number[] = [];
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (envelope) => {
        attemptedSequences.push(envelope.sequenceNumber);
        throw new Error("redis down");
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      {
        canonical: 7,
        native: 0,
        canonicalEnd: 100,
        nativeEnd: 100,
        claimAttemptId: "attempt-1",
        ensureReservation: async () => 200,
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        await expect(
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ).rejects.toThrow("redis down");
        expect(getCurrentStreamSequenceHighWater().canonical).toBe(7);
        await expect(publisher.close()).rejects.toThrow("redis down");
      },
    );

    expect(attemptedSequences).toEqual([8, 8, 8]);
  });

  it("extends a reservation at 75% before publishing and never crosses the old end on failure", async () => {
    const calls: string[] = [];
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (envelope) => {
        calls.push(`xadd:${envelope.sequenceNumber}`);
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      {
        canonical: 0,
        native: 0,
        canonicalEnd: 4,
        nativeEnd: 4,
        claimAttemptId: "attempt-1",
        ensureReservation: async (channel, requiredThrough) => {
          calls.push(`ensure:${channel}:${requiredThrough}`);
          throw new Error("reservation unavailable");
        },
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          maxPublishAttempts: 1,
        });
        await publishCanonicalEvent(publisher, canonicalEnvelope());
        await publishCanonicalEvent(publisher, canonicalEnvelope());
        await expect(
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ).rejects.toThrow("reservation unavailable");
        expect(getCurrentStreamSequenceHighWater().canonical).toBe(2);
        await expect(publisher.close()).rejects.toThrow("reservation unavailable");
      },
    );

    expect(calls).toEqual([
      "xadd:1",
      "xadd:2",
      "ensure:sessionEvents:5",
    ]);
  });

  it("serializes concurrent reservation renewal and applies its end monotonically", async () => {
    let resolveEnsure!: (value: number) => void;
    const ensureBarrier = new Promise<number>((resolve) => {
      resolveEnsure = resolve;
    });
    const xadds: number[] = [];
    let ensureCalls = 0;
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (envelope) => {
        xadds.push(envelope.sequenceNumber);
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      {
        canonical: 0,
        native: 0,
        canonicalEnd: 4,
        nativeEnd: 4,
        claimAttemptId: "attempt-1",
        ensureReservation: async () => {
          ensureCalls += 1;
          return ensureBarrier;
        },
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        await publishCanonicalEvent(publisher, canonicalEnvelope());
        await publishCanonicalEvent(publisher, canonicalEnvelope());

        const third = publishCanonicalEvent(publisher, canonicalEnvelope());
        const fourth = publishCanonicalEvent(publisher, canonicalEnvelope());
        await Promise.resolve();
        await Promise.resolve();
        expect(ensureCalls).toBe(1);
        expect(xadds).toEqual([1, 2]);

        resolveEnsure(8);
        await Promise.all([third, fourth]);
        await publisher.close();
      },
    );

    expect(ensureCalls).toBe(1);
    expect(xadds).toEqual([1, 2, 3, 4]);
  });

  it("fails before XADD when the persisted INT32 sequence space is exhausted", async () => {
    let xaddCalls = 0;
    const underlying: StreamPublisher = {
      publish: async () => {
        xaddCalls += 1;
        return "0-0";
      },
      publishCanonicalEnvelope: async () => {
        xaddCalls += 1;
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      {
        canonical: 2_147_483_647,
        native: 0,
        canonicalEnd: 2_147_483_647,
        nativeEnd: 10,
        claimAttemptId: "attempt-1",
        ensureReservation: async () => 2_147_483_647,
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        await expect(
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ).rejects.toThrow("INT32");
        await expect(publisher.close()).rejects.toThrow("INT32");
      },
    );
    expect(xaddCalls).toBe(0);
  });

  it("freezes new publications as soon as close begins and waits for in-flight XADD", async () => {
    let finishFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async () => {
        await firstBarrier;
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        const first = publishCanonicalEvent(publisher, canonicalEnvelope());
        await Promise.resolve();
        const closing = publisher.close();
        await expect(
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ).rejects.toThrow("frozen");
        finishFirst();
        await first;
        await closing;
      },
    );
  });

  it("propagates the live deadline into XADD and does not commit high-water after abort", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const underlying = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (
        _envelope: CanonicalEventEnvelope,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        observedSignal = requestOptions?.signal;
        controller.abort(new Error("terminal_deadline_exceeded"));
        await Promise.resolve();
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    } as StreamPublisher;

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          operationOptions: () => ({
            signal: controller.signal,
            timeoutMs: 30_000,
          }),
        });

        await expect(
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ).rejects.toThrow("terminal_deadline_exceeded");
        expect(observedSignal).toBe(controller.signal);
        expect(getCurrentStreamSequenceHighWater().canonical).toBe(0);
      },
    );
  });

  it("latches a deadline that closes while an accepted event waits behind the durable tail", async () => {
    const workController = new AbortController();
    const terminalController = new AbortController();
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let xaddCalls = 0;
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async () => {
        xaddCalls += 1;
        if (xaddCalls === 1) await firstBarrier;
        return `0-${xaddCalls}`;
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          operationOptions: () => ({
            signal: workController.signal,
            timeoutMs: 30_000,
          }),
        });
        const first = publishCanonicalEvent(
          publisher,
          canonicalEnvelope(),
          { signal: terminalController.signal, timeoutMs: 30_000 },
        );
        await Promise.resolve();
        const acceptedBeforeCutoff = publishCanonicalEvent(
          publisher,
          canonicalEnvelope(),
        );
        workController.abort(
          new Error("terminal_deadline_exceeded"),
        );
        releaseFirst();

        await first;
        await expect(acceptedBeforeCutoff).rejects.toThrow(
          "terminal_deadline_exceeded",
        );
        expect(xaddCalls).toBe(1);
        await expect(publisher.close({
          signal: terminalController.signal,
          timeoutMs: 30_000,
        })).rejects.toThrow("terminal_deadline_exceeded");
      },
    );
  });

  it("serializes a terminal event behind a slow publisher and commits high-water in order", async () => {
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const order: string[] = [];
    let calls = 0;
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async (envelope) => {
        calls += 1;
        order.push(`start:${envelope.sequenceNumber}:${envelope.event.kind}`);
        if (calls === 1) {
          markFirstStarted();
          await firstBarrier;
        }
        order.push(`finish:${envelope.sequenceNumber}:${envelope.event.kind}`);
        return `0-${calls}`;
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {
        order.push("close");
      },
    };

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          maxPendingEvents: 4,
        });
        const first = publishCanonicalEvent(publisher, canonicalEnvelope());
        const terminal = publishCanonicalEvent(publisher, {
          ...canonicalEnvelope(),
          event: { kind: "job.completed", summary: "done" },
        });
        await firstStarted;
        expect(order).toEqual(["start:1:system.info"]);

        const closing = publisher.close();
        releaseFirst();
        await Promise.all([first, terminal, closing]);
        expect(getCurrentStreamSequenceHighWater()).toEqual({
          canonical: 2,
          native: 0,
        });
      },
    );

    expect(order).toEqual([
      "start:1:system.info",
      "finish:1:system.info",
      "start:2:job.completed",
      "finish:2:job.completed",
      "close",
    ]);
  });

  it("fails instead of dropping a terminal event at the pending-event cap", async () => {
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let xaddCalls = 0;
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async () => {
        xaddCalls += 1;
        markFirstStarted();
        await firstBarrier;
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          maxPendingEvents: 2,
        });
        const first = publishCanonicalEvent(publisher, canonicalEnvelope());
        await firstStarted;
        const second = publishCanonicalEvent(publisher, canonicalEnvelope());
        const terminal = publishCanonicalEvent(publisher, {
          ...canonicalEnvelope(),
          event: { kind: "job.completed", summary: "must be durable" },
        });

        await expect(terminal).rejects.toBeInstanceOf(StreamPublishCapacityError);
        releaseFirst();
        await first;
        await expect(second).rejects.toBeInstanceOf(StreamPublishCapacityError);
        expect(getCurrentStreamSequenceHighWater().canonical).toBe(1);
        await expect(publisher.close()).rejects.toBeInstanceOf(
          StreamPublishCapacityError,
        );
      },
    );

    expect(xaddCalls).toBe(1);
  });

  it("fails closed with typed byte metadata when one UTF-8 event exceeds capacity", async () => {
    const underlying: StreamPublisher = {
      publish: async () => "0-0",
      publishCanonicalEnvelope: async () => "0-0",
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    await runWithStreamSequenceBases(
      { canonical: 0, native: 0 },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying, {
          maxPendingBytes: 64,
        });
        const publication = publishCanonicalEvent(publisher, {
          ...canonicalEnvelope(),
          event: { kind: "system.info", message: "🙂".repeat(32) },
        });

        try {
          await publication;
          throw new Error("expected stream byte overflow");
        } catch (error) {
          expect(error).toBeInstanceOf(StreamPublishCapacityError);
          expect(error).toMatchObject({
            code: "STREAM_PUBLISH_CAPACITY_EXCEEDED",
            resource: "pending_bytes",
            limit: 64,
          });
          expect(String(error)).not.toContain("🙂");
        }
        expect(getCurrentStreamSequenceHighWater().canonical).toBe(0);
      },
    );
  });

  it("bounds a stalled publish attempt without sleeping", async () => {
    jest.useFakeTimers();
    try {
      let markPublishStarted!: () => void;
      const publishStarted = new Promise<void>((resolve) => {
        markPublishStarted = resolve;
      });
      const underlying: StreamPublisher = {
        publish: async () => "0-0",
        publishCanonicalEnvelope: async () => {
          markPublishStarted();
          return new Promise<string>(() => {});
        },
        publishNativeEnvelope: async () => "0-0",
        close: async () => {},
      };

      await runWithStreamSequenceBases(
        { canonical: 0, native: 0 },
        async () => {
          const publisher = createSequencedStreamPublisher(underlying, {
            maxPublishAttempts: 1,
            publishAttemptTimeoutMs: 50,
            closeTimeoutMs: 50,
          });
          const publication = publishCanonicalEvent(
            publisher,
            canonicalEnvelope(),
          );
          await publishStarted;
          jest.advanceTimersByTime(50);

          await expect(publication).rejects.toBeInstanceOf(
            StreamPublishTimeoutError,
          );
          expect(getCurrentStreamSequenceHighWater().canonical).toBe(0);
          await expect(publisher.close()).rejects.toBeInstanceOf(
            StreamPublishTimeoutError,
          );
        },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds close while an accepted publication remains stalled", async () => {
    jest.useFakeTimers();
    try {
      let closeCalls = 0;
      let markPublishStarted!: () => void;
      const publishStarted = new Promise<void>((resolve) => {
        markPublishStarted = resolve;
      });
      const underlying: StreamPublisher = {
        publish: async () => "0-0",
        publishCanonicalEnvelope: async () => {
          markPublishStarted();
          return new Promise<string>(() => {});
        },
        publishNativeEnvelope: async () => "0-0",
        close: async () => {
          closeCalls += 1;
        },
      };

      await runWithStreamSequenceBases(
        { canonical: 0, native: 0 },
        async () => {
          const publisher = createSequencedStreamPublisher(underlying, {
            maxPublishAttempts: 1,
            publishAttemptTimeoutMs: 1_000,
            closeTimeoutMs: 50,
          });
          const publication = publishCanonicalEvent(
            publisher,
            canonicalEnvelope(),
          );
          await publishStarted;
          const closing = publisher.close();
          jest.advanceTimersByTime(50);

          await expect(closing).rejects.toMatchObject({
            code: "STREAM_PUBLISH_TIMEOUT",
            operation: "close",
          });
          expect(closeCalls).toBe(1);

          jest.advanceTimersByTime(950);
          await expect(publication).rejects.toMatchObject({
            code: "STREAM_PUBLISH_TIMEOUT",
            operation: "publish",
          });
        },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps legacy output ordered without adding it to the durable receipt range", async () => {
    const deliveryOrder: string[] = [];
    const canonical: CanonicalEventEnvelope[] = [];
    const legacy: AgentOutputEvent[] = [];
    const underlying: StreamPublisher = {
      publish: async (event) => {
        legacy.push(event);
        deliveryOrder.push(`legacy:${event.type}`);
        return "0-0";
      },
      publishCanonicalEnvelope: async (envelope) => {
        canonical.push(envelope);
        deliveryOrder.push(`canonical:${envelope.sequenceNumber}`);
        return "0-0";
      },
      publishNativeEnvelope: async () => "0-0",
      close: async () => {},
    };

    const highWater = await runWithStreamSequenceBases(
      {
        canonical: 10,
        native: 20,
        canonicalEnd: 4_106,
        nativeEnd: 4_116,
        claimAttemptId: "attempt-legacy",
        ensureReservation: async () => 8_202,
      },
      async () => {
        const publisher = createSequencedStreamPublisher(underlying);
        const adapter = createStreamChannelAdapter({
          streamPublisher: publisher,
          jobId: "job-1",
          sessionId: "session-1",
          workspaceId: "workspace-1",
          threadId: "thread-1",
        });

        const publications = [
          publishCanonicalEvent(publisher, canonicalEnvelope()),
          adapter.sendMessage("thread-1", "legacy message"),
          adapter.sendRichMessage("thread-1", { title: "legacy card" }),
          publishStreamEvent(publisher, {
            type: "rich_message",
            jobId: "job-1",
            sessionId: "session-1",
            workspaceId: "workspace-1",
            threadId: "thread-1",
            timestamp: Date.now(),
            payload: { title: "opening embed" },
          }),
          publishCanonicalEvent(publisher, canonicalEnvelope()),
        ];

        await Promise.all(publications);
        const emitted = getCurrentStreamSequenceHighWater();
        await publisher.close();
        return emitted;
      },
    );

    expect(deliveryOrder).toEqual([
      "canonical:11",
      "legacy:message",
      "legacy:rich_message",
      "legacy:rich_message",
      "canonical:12",
    ]);
    expect(canonical.map((envelope) => envelope.sequenceNumber)).toEqual([11, 12]);
    expect(highWater).toEqual({ canonical: 12, native: 20 });
    expect(legacy.map((event) => event.sequenceNumber)).toEqual([1, 2, 3]);
    for (const event of legacy) {
      expect(event.sequenceProtocolVersion).toBeUndefined();
      expect(event.claimAttemptId).toBeUndefined();
    }
  });
});
