import { describe, expect, it, jest } from "bun:test";
import {
  createNativeDeltaCoalescer,
  NativeDeltaCoalescerLimitError,
  type NativeDeltaEnvelopeInput,
} from "./native-delta-coalescer";

const delta = (
  text: string,
  overrides: { contentType?: string; sessionId?: string } = {},
): NativeDeltaEnvelopeInput => ({
  jobId: "job-1",
  nativeEventType: "message.part.delta",
  sourceFormat: "runtime-sse",
  payload: {
    event: "message",
    data: {
      type: "message.part.delta",
      properties: {
        delta: text,
        sessionId: overrides.sessionId ?? "session-1",
        contentType: overrides.contentType ?? "text",
      },
    },
  },
});

const readDelta = (envelope: NativeDeltaEnvelopeInput): unknown => {
  const data = (envelope.payload as { data?: { properties?: { delta?: unknown } } }).data;
  return data?.properties?.delta;
};

describe("createNativeDeltaCoalescer", () => {
  it("collapses a run of deltas into a single envelope", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({ onFlush: (e) => void flushed.push(e) });

    coalescer.push(delta("Hola"));
    coalescer.push(delta(" mundo"));
    coalescer.push(delta("!"));
    coalescer.destroy();

    expect(flushed).toHaveLength(1);
    expect(readDelta(flushed[0]!)).toBe("Hola mundo!");
  });

  it("flushes the pending run before passing a non-delta event through", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({ onFlush: (e) => void flushed.push(e) });

    coalescer.push(delta("texto"));
    coalescer.push({ jobId: "job-1", nativeEventType: "session.status", payload: {} });
    coalescer.destroy();

    expect(flushed.map((e) => e.nativeEventType)).toEqual([
      "message.part.delta",
      "session.status",
    ]);
    expect(readDelta(flushed[0]!)).toBe("texto");
  });

  it("does not merge across content types or sessions", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({ onFlush: (e) => void flushed.push(e) });

    coalescer.push(delta("pienso", { contentType: "thinking" }));
    coalescer.push(delta("digo", { contentType: "text" }));
    coalescer.push(delta("otra", { contentType: "text", sessionId: "session-2" }));
    coalescer.destroy();

    expect(flushed).toHaveLength(3);
    expect(flushed.map(readDelta)).toEqual(["pienso", "digo", "otra"]);
  });

  it("passes an unrecognised delta shape through untouched", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({ onFlush: (e) => void flushed.push(e) });

    const malformed: NativeDeltaEnvelopeInput = {
      jobId: "job-1",
      nativeEventType: "message.part.delta",
      payload: { event: "message", data: "raw-sse-string" },
    };
    coalescer.push(malformed);
    coalescer.destroy();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.payload).toEqual({ event: "message", data: "raw-sse-string" });
  });

  it("preserves the surviving envelope metadata of the run it started", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({ onFlush: (e) => void flushed.push(e) });

    coalescer.push({ ...delta("uno"), emittedAt: "2026-08-08T19:00:00.000Z" });
    coalescer.push({ ...delta(" dos"), emittedAt: "2026-08-08T19:00:09.000Z" });
    coalescer.destroy();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.emittedAt).toBe("2026-08-08T19:00:00.000Z");
    expect(flushed[0]?.sourceFormat).toBe("runtime-sse");
  });

  it("splits repeated deltas at a UTF-8 byte boundary without corrupting multibyte text", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({
      onFlush: (event) => void flushed.push(event),
      maxBufferBytes: 4,
      idleMs: 10_000,
    });

    coalescer.push(delta("é"));
    coalescer.push(delta("é"));
    coalescer.push(delta("🙂"));
    coalescer.destroy();

    expect(flushed.map(readDelta)).toEqual(["éé", "🙂"]);
    expect(flushed.map((event) => Buffer.byteLength(String(readDelta(event))))).toEqual([4, 4]);
  });

  it("fails closed with typed safe metadata when one native delta exceeds the byte cap", () => {
    const coalescer = createNativeDeltaCoalescer({
      onFlush: () => {},
      maxBufferBytes: 4,
    });

    try {
      coalescer.push(delta("🙂secret"));
      throw new Error("expected native delta overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(NativeDeltaCoalescerLimitError);
      expect(error).toMatchObject({
        code: "NATIVE_DELTA_COALESCER_LIMIT",
        resource: "buffer_bytes",
        limit: 4,
        observed: 10,
      });
      expect(String(error)).not.toContain("secret");
    }
  });

  it("bounds items per native buffer and preserves delta order across splits", () => {
    const flushed: NativeDeltaEnvelopeInput[] = [];
    const coalescer = createNativeDeltaCoalescer({
      onFlush: (event) => void flushed.push(event),
      maxItemsPerBuffer: 2,
      idleMs: 10_000,
    });

    for (const part of ["a", "b", "c", "d", "e"]) coalescer.push(delta(part));
    coalescer.destroy();

    expect(flushed.map(readDelta)).toEqual(["ab", "cd", "e"]);
  });

  it("fails closed when a native coalesce key exceeds its UTF-8 byte cap", () => {
    const coalescer = createNativeDeltaCoalescer({
      onFlush: () => {},
      maxKeyBytes: 8,
    });

    expect(() =>
      coalescer.push(delta("safe", { sessionId: "session-too-long" })),
    ).toThrow(NativeDeltaCoalescerLimitError);
  });

  it("flushes at the bounded maximum interval even while deltas keep resetting idle", () => {
    jest.useFakeTimers();
    try {
      const flushed: NativeDeltaEnvelopeInput[] = [];
      const coalescer = createNativeDeltaCoalescer({
        onFlush: (event) => void flushed.push(event),
        idleMs: 100,
        maxFlushIntervalMs: 250,
      });

      coalescer.push(delta("a"));
      jest.advanceTimersByTime(90);
      coalescer.push(delta("b"));
      jest.advanceTimersByTime(90);
      coalescer.push(delta("c"));
      jest.advanceTimersByTime(70);

      expect(flushed.map(readDelta)).toEqual(["abc"]);
      coalescer.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds pending asynchronous flushes when many native keys arrive", async () => {
    let release!: () => void;
    const slowFlush = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coalescer = createNativeDeltaCoalescer({
      onFlush: () => slowFlush,
      maxPendingFlushes: 2,
      idleMs: 10_000,
    });

    coalescer.push(delta("a", { sessionId: "one" }));
    coalescer.push(delta("b", { sessionId: "two" }));
    coalescer.push(delta("c", { sessionId: "three" }));
    expect(() =>
      coalescer.push(delta("d", { sessionId: "four" })),
    ).toThrow(NativeDeltaCoalescerLimitError);

    release();
    await slowFlush;
  });
});
