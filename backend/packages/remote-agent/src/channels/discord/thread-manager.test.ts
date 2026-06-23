import { describe, expect, it } from "bun:test";
import { createDiscordThreadManager } from "./thread-manager";

describe("DiscordThreadManager", () => {
  it("creates thread and posts opening message", async () => {
    let createdName = "";
    let sentThreadId = "";
    let sentContent = "";

    const manager = createDiscordThreadManager({
      createThread: async (args) => {
        createdName = args.name;
        return { id: "thread-1", name: args.name };
      },
      renameThread: async (threadId, name) => ({ id: threadId, name }),
      archiveThread: async () => undefined,
      sendMessage: async () => ({ id: "m1", content: "ok" }),
      sendRichMessage: async (threadId, payload) => {
        sentThreadId = threadId;
        sentContent = payload.content ?? "";
        return { id: "m-open", content: payload.content ?? "" };
      },
    });

    const thread = await manager.createJobThread({
      channelId: "channel-1",
      skill: "implement",
      taskIds: ["A-475", "A-476"],
      requesterId: "user-1",
    });

    expect(thread.id).toBe("thread-1");
    expect(createdName).toContain("Implementando");
    expect(sentThreadId).toBe("thread-1");
    expect(sentContent).toContain("<@user-1>");
  });

  it("renames with lifecycle prefixes", async () => {
    let renamedTo = "";

    const manager = createDiscordThreadManager({
      createThread: async () => ({ id: "thread-1", name: "n" }),
      renameThread: async (_threadId, name) => {
        renamedTo = name;
        return { id: "thread-1", name };
      },
      archiveThread: async () => undefined,
      sendMessage: async () => ({ id: "m1", content: "ok" }),
      sendRichMessage: async () => ({ id: "m2", content: "ok" }),
    });

    await manager.renameOnCompletion({
      threadId: "thread-1",
      baseName: "implement-A-475",
      status: "failed",
    });

    expect(renamedTo).toContain("❌");
  });
});
