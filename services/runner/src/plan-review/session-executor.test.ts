import { describe, expect, it } from "bun:test";
import { executePlanReviewPrompt } from "./session-executor";

describe("isolated Plan Review session executor", () => {
  it("returns only assistant text after session idle and preserves the request boundary", async () => {
    const prompts: string[] = [];
    const result = await executePlanReviewPrompt({
      prompt: "review the frozen plan",
      sessionManager: {
        createSession: async () => ({ id: "session-1" }),
        sendPromptAsync: async (_sessionId, input) => {
          prompts.push(input.prompt);
        },
        streamSessionEvents: () => (async function* () {
          yield {
            event: "message.part.delta",
            data: JSON.stringify({ type: "message.part.delta", properties: { text: "{\"outcome\":\"accept\"}" } }),
          };
          yield { event: "session.idle", data: JSON.stringify({ type: "session.idle", properties: {} }) };
        })(),
      },
    });

    expect(result).toBe('{"outcome":"accept"}');
    expect(prompts).toEqual(["review the frozen plan"]);
  });

  it("classifies a session that closes before idle as process loss", async () => {
    await expect(executePlanReviewPrompt({
      prompt: "review",
      sessionManager: {
        createSession: async () => ({ id: "session-1" }),
        sendPromptAsync: async () => undefined,
        streamSessionEvents: () => (async function* () {
          yield { event: "session.closed", data: JSON.stringify({ type: "session.closed", properties: {} }) };
        })(),
      },
    })).rejects.toMatchObject({ code: "process_lost" });
  });
});
