import { describe, expect, it } from "bun:test";
import { createDiscordChannelAdapter } from "./adapter";

const asFetch = (
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => fn as unknown as typeof fetch;

const jsonResponse = (status: number, body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

describe("DiscordChannelAdapter", () => {
  it("sends truncated messages with auth header", async () => {
    let authHeader = "";
    let payload = "";

    const adapter = createDiscordChannelAdapter(
      {
        botToken: "bot-123",
        apiBaseUrl: "https://discord.example/api/v10",
      },
      {
        fetchFn: asFetch(async (_input, init) => {
          authHeader = new Headers(init?.headers).get("authorization") ?? "";
          payload = String(init?.body ?? "");

          return jsonResponse(200, {
            id: "m1",
            content: "ok",
            author: { id: "bot" },
          });
        }),
      }
    );

    await adapter.sendMessage("thread-1", `\u001b[31m${"x".repeat(2500)}`);

    expect(authHeader).toBe("Bot bot-123");
    const parsed = JSON.parse(payload) as { content: string };
    expect(parsed.content.length).toBe(2000);
    expect(parsed.content.includes("\u001b")).toBe(false);
  });

  it("creates threads with capped names and archive duration", async () => {
    let body = "";

    const adapter = createDiscordChannelAdapter(
      {
        botToken: "bot-123",
        apiBaseUrl: "https://discord.example/api/v10",
      },
      {
        fetchFn: asFetch(async (_input, init) => {
          body = String(init?.body ?? "");
          return jsonResponse(200, {
            id: "thread-1",
            name: "created-thread",
            archived: false,
          });
        }),
      }
    );

    const thread = await adapter.createThread({
      channelId: "channel-1",
      name: "very-long-" + "n".repeat(150),
      autoArchiveDurationMinutes: 1440,
    });

    const parsed = JSON.parse(body) as {
      name: string;
      auto_archive_duration: number;
    };

    expect(thread.id).toBe("thread-1");
    expect(parsed.name.length).toBeLessThanOrEqual(100);
    expect(parsed.auto_archive_duration).toBe(1440);
  });

  it("waits for replies and filters by requester", async () => {
    let now = 0;
    let polls = 0;

    const adapter = createDiscordChannelAdapter(
      {
        botToken: "bot-123",
        apiBaseUrl: "https://discord.example/api/v10",
      },
      {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        fetchFn: asFetch(async (_input, init) => {
          if ((init?.method ?? "GET") !== "GET") {
            return jsonResponse(200, {});
          }

          polls += 1;
          if (polls === 1) {
            return jsonResponse(200, [
              {
                id: "msg-1",
                content: "from another user",
                timestamp: "2026-03-01T00:00:00.000Z",
                author: { id: "user-2", bot: false },
              },
            ]);
          }

          return jsonResponse(200, [
            {
              id: "msg-2",
              content: "approved",
              timestamp: "2026-03-01T00:00:01.000Z",
              author: { id: "user-1", bot: false },
            },
          ]);
        }),
      }
    );

    const reply = await adapter.waitForThreadReply({
      threadId: "thread-1",
      requesterId: "user-1",
      timeoutMs: 5000,
      pollIntervalMs: 100,
    });

    expect(reply?.content).toBe("approved");
    expect(reply?.userId).toBe("user-1");
    expect(polls).toBe(2);
  });

  it("deletes messages from a thread", async () => {
    let method = "";
    let path = "";

    const adapter = createDiscordChannelAdapter(
      {
        botToken: "bot-123",
        apiBaseUrl: "https://discord.example/api/v10",
      },
      {
        fetchFn: asFetch(async (input, init) => {
          method = init?.method ?? "";
          path = String(input);
          return new Response(null, { status: 204 });
        }),
      }
    );

    await adapter.deleteMessage("thread-1", "msg-1");

    expect(method).toBe("DELETE");
    expect(path).toContain("/channels/thread-1/messages/msg-1");
  });
});
