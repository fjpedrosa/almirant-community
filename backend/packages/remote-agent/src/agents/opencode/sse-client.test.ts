import { describe, expect, it } from "bun:test";
import { createOpenCodeSseClient } from "./sse-client";

const asFetch = (
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => fn as unknown as typeof fetch;

const streamFromText = (text: string): ReadableStream<Uint8Array> => {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
};

describe("OpenCodeSseClient", () => {
  it("parses SSE event blocks", async () => {
    const client = createOpenCodeSseClient(
      { baseUrl: "http://localhost:4096", maxReconnectAttempts: 0 },
      {
        fetchFn: asFetch(async () =>
          new Response(streamFromText("event: message\nid: 1\ndata: hello\\nworld\n\n"), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })),
      }
    );

    const iterator = client.subscribe("/event")[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      event: "message",
      id: "1",
      data: "hello\\nworld",
      raw: "event: message\nid: 1\ndata: hello\\nworld",
    });

    await iterator.return?.(undefined);
  });

  it("reconnects when stream closes", async () => {
    let calls = 0;

    const client = createOpenCodeSseClient(
      {
        baseUrl: "http://localhost:4096",
        maxReconnectAttempts: 2,
        reconnectBaseDelayMs: 0,
        reconnectMaxDelayMs: 0,
      },
      {
        fetchFn: asFetch(async () => {
          calls += 1;
          const payload =
            calls === 1
              ? "data: first\n\n"
              : "data: second\n\n";

          return new Response(streamFromText(payload), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }),
        sleepFn: async () => undefined,
      }
    );

    const iterator = client.subscribe("/event")[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value?.data).toBe("first");
    expect(second.value?.data).toBe("second");
    expect(calls).toBeGreaterThanOrEqual(2);

    await iterator.return?.(undefined);
  });
});
