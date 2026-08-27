import { describe, expect, it } from "bun:test";
import type {
  CanonicalEventListener,
  NativeEventListener,
  RuntimeAdapter,
  RuntimeEventListener,
} from "./adapter.js";
import { createQueuedAdapter } from "./session-queue.js";
import type { PromptRequest, SSEEvent } from "./types.js";

const prompt = (text: string): PromptRequest => ({
  parts: [{ type: "text", text }],
});

const promptText = (request: PromptRequest): string =>
  request.parts.map((part) => part.text).join("");

const flushAsyncWork = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("createQueuedAdapter", () => {
  it("drains exactly one queued prompt for each idle transition", async () => {
    let runtimeListener: RuntimeEventListener | undefined;
    let running = false;
    const sent: string[] = [];
    const forwarded: SSEEvent[] = [];

    const adapter: RuntimeAdapter = {
      async createSession() {
        return { id: "session-1" };
      },
      async sendPrompt(_sessionId, request) {
        if (running) {
          throw new Error("concurrent prompt execution");
        }
        running = true;
        sent.push(promptText(request));
      },
      onEvent(listener) {
        runtimeListener = listener;
        return () => {
          runtimeListener = undefined;
        };
      },
    };

    const queued = createQueuedAdapter(adapter, () => {});
    queued.onEvent((event) => forwarded.push(event));

    await queued.sendPrompt("session-1", prompt("first"));
    await queued.sendPrompt("session-1", prompt("second"));
    await queued.sendPrompt("session-1", prompt("third"));

    running = false;
    const idle = {
      type: "session.idle",
      properties: { sessionId: "session-1" },
    } satisfies SSEEvent;
    runtimeListener?.(idle);
    runtimeListener?.(idle);

    await flushAsyncWork();
    expect(sent).toEqual(["first", "second"]);

    running = false;
    runtimeListener?.(idle);
    await flushAsyncWork();
    expect(sent).toEqual(["first", "second", "third"]);

    running = false;
    runtimeListener?.(idle);
    expect(forwarded.filter((event) => event.type === "session.idle")).toHaveLength(1);
  });

  it("continues with the next prompt when a dequeued send fails", async () => {
    let runtimeListener: RuntimeEventListener | undefined;
    let running = false;
    const sent: string[] = [];
    const broadcasts: SSEEvent[] = [];

    const adapter: RuntimeAdapter = {
      async createSession() {
        return { id: "session-1" };
      },
      async sendPrompt(_sessionId, request) {
        if (running) {
          throw new Error("concurrent prompt execution");
        }
        const text = promptText(request);
        running = true;
        sent.push(text);
        if (text === "second") {
          running = false;
          throw new Error("queued send failed");
        }
      },
      onEvent(listener) {
        runtimeListener = listener;
        return () => {
          runtimeListener = undefined;
        };
      },
    };

    const queued = createQueuedAdapter(adapter, (event) => broadcasts.push(event));
    queued.onEvent(() => {});

    await queued.sendPrompt("session-1", prompt("first"));
    await queued.sendPrompt("session-1", prompt("second"));
    await queued.sendPrompt("session-1", prompt("third"));

    running = false;
    runtimeListener?.({
      type: "session.idle",
      properties: { sessionId: "session-1" },
    });
    await flushAsyncWork();

    expect(sent).toEqual(["first", "second", "third"]);
    expect(broadcasts).toContainEqual({
      type: "session.status",
      properties: {
        sessionId: "session-1",
        status: "error",
        message: "queued send failed",
      },
    });
  });

  it("enforces a configurable per-session queue depth limit", async () => {
    const adapter: RuntimeAdapter = {
      async createSession() {
        return { id: "session-1" };
      },
      async sendPrompt() {},
      onEvent() {
        return () => {};
      },
    };

    const queued = createQueuedAdapter(adapter, () => {}, undefined, {
      maxQueueDepth: 1,
    });

    await queued.sendPrompt("session-1", prompt("first"));
    await queued.sendPrompt("session-1", prompt("second"));

    await expect(
      queued.sendPrompt("session-1", prompt("third")),
    ).rejects.toThrow("Session queue limit of 1 reached for session session-1");
  });

  it("clears queued prompts before abort, delete, and close", async () => {
    let runtimeListener: RuntimeEventListener | undefined;
    const sent: string[] = [];
    const running = new Set<string>();
    let closeCalls = 0;

    const emitIdle = (sessionId: string): void => {
      running.delete(sessionId);
      runtimeListener?.({
        type: "session.idle",
        properties: { sessionId },
      });
    };

    const adapter: RuntimeAdapter = {
      async createSession() {
        return { id: "created" };
      },
      async sendPrompt(sessionId, request) {
        if (running.has(sessionId)) {
          throw new Error(`concurrent prompt execution for ${sessionId}`);
        }
        running.add(sessionId);
        sent.push(`${sessionId}:${promptText(request)}`);
      },
      async abortSession(sessionId) {
        emitIdle(sessionId);
        return true;
      },
      async deleteSession(sessionId) {
        emitIdle(sessionId);
        return true;
      },
      async close() {
        closeCalls += 1;
        for (const sessionId of [...running]) {
          emitIdle(sessionId);
        }
      },
      onEvent(listener) {
        runtimeListener = listener;
        return () => {
          runtimeListener = undefined;
        };
      },
    };

    const queued = createQueuedAdapter(adapter, () => {});
    queued.onEvent(() => {});

    await queued.sendPrompt("abort-me", prompt("active"));
    await queued.sendPrompt("abort-me", prompt("must-not-run"));
    await expect(queued.abortSession?.("abort-me")).resolves.toBe(true);

    await queued.sendPrompt("delete-me", prompt("active"));
    await queued.sendPrompt("delete-me", prompt("must-not-run"));
    await expect(queued.deleteSession?.("delete-me")).resolves.toBe(true);

    await queued.sendPrompt("close-me", prompt("active"));
    await queued.sendPrompt("close-me", prompt("must-not-run"));
    await Promise.all([queued.close?.(), queued.close?.()]);
    await flushAsyncWork();

    expect(sent).toEqual([
      "abort-me:active",
      "delete-me:active",
      "close-me:active",
    ]);
    expect(closeCalls).toBe(1);
    await expect(
      queued.sendPrompt("close-me", prompt("after-close")),
    ).rejects.toThrow("Queued adapter is closed");
  });

  it("forwards lifecycle, lookup, canonical, and native adapter capabilities", async () => {
    let canonicalListener: CanonicalEventListener | undefined;
    let nativeListener: NativeEventListener | undefined;
    const calls: string[] = [];

    const adapter: RuntimeAdapter = {
      async createSession(input) {
        calls.push(`create:${input.cwd}`);
        return { id: "session-1", cwd: input.cwd };
      },
      async sendPrompt() {},
      onEvent() {
        return () => {};
      },
      onCanonicalEvent(listener) {
        canonicalListener = listener;
        return () => {
          canonicalListener = undefined;
        };
      },
      onNativeEvent(listener) {
        nativeListener = listener;
        return () => {
          nativeListener = undefined;
        };
      },
      async listSessions() {
        calls.push("list");
        return [{ id: "session-1" }];
      },
      async getSession(sessionId) {
        calls.push(`get:${sessionId}`);
        return { id: sessionId };
      },
    };

    const queued = createQueuedAdapter(adapter, () => {});
    const canonicalEvents: unknown[] = [];
    const nativeEvents: unknown[] = [];
    const stopCanonical = queued.onCanonicalEvent?.((event) =>
      canonicalEvents.push(event),
    );
    const stopNative = queued.onNativeEvent?.((event) => nativeEvents.push(event));

    await expect(queued.createSession({ cwd: "/workspace" })).resolves.toEqual({
      id: "session-1",
      cwd: "/workspace",
    });
    await expect(queued.listSessions?.()).resolves.toEqual([{ id: "session-1" }]);
    await expect(queued.getSession?.("session-1")).resolves.toEqual({
      id: "session-1",
    });

    canonicalListener?.({ kind: "system.warn", message: "warning" });
    nativeListener?.({
      nativeEventType: "runtime.event",
      sourceFormat: "test",
      payload: { ok: true },
    });

    expect(calls).toEqual(["create:/workspace", "list", "get:session-1"]);
    expect(canonicalEvents).toEqual([
      { kind: "system.warn", message: "warning" },
    ]);
    expect(nativeEvents).toEqual([
      {
        nativeEventType: "runtime.event",
        sourceFormat: "test",
        payload: { ok: true },
      },
    ]);

    stopCanonical?.();
    stopNative?.();
    expect(canonicalListener).toBeUndefined();
    expect(nativeListener).toBeUndefined();
  });
});
