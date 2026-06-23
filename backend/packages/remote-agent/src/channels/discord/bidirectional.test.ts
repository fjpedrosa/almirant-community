import { describe, expect, it } from "bun:test";
import { createBidirectionalRelay } from "./bidirectional";

const waitFor = async (
  condition: () => boolean,
  timeoutMs = 200
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await Promise.resolve();
  }
};

describe("BidirectionalRelay", () => {
  it("relays user responses to runtime session via interaction polling", async () => {
    const prompts: Array<{ prompt: string; metadata?: Record<string, unknown> }> = [];
    let polls = 0;

    const relay = createBidirectionalRelay({
      threadId: "thread-1",
      sessionId: "session-1",
      jobId: "job-1",
      optionsMergeWindowMs: 1,
      timeoutMs: 100,
      pollIntervalMs: 1,
      now: (() => {
        let tick = 0;
        return () => tick++;
      })(),
      sleep: async () => {
        await Promise.resolve();
      },
      runtime: {
        sendPrompt: async (_sessionId, input) => {
          prompts.push(input);
          return { ok: true };
        },
      },
      workerClient: {
        createInteraction: async () => ({
          id: "interaction-1",
          agentJobId: "job-1",
          status: "pending",
          questionType: "choice",
          questionText: "Choose option",
          questionContext: null,
          options: ["Yes", "No"],
          response: null,
          responseSource: null,
          answeredAt: null,
          expiresAt: new Date().toISOString(),
          timeoutAction: "continue",
          defaultAnswer: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        pollInteraction: async () => {
          polls += 1;
          if (polls < 2) {
            return {
              id: "interaction-1",
              agentJobId: "job-1",
              status: "pending",
              questionType: "choice",
              questionText: "Choose option",
              questionContext: null,
              options: ["Yes", "No"],
              response: null,
              responseSource: null,
              answeredAt: null,
              expiresAt: new Date().toISOString(),
              timeoutAction: "continue",
              defaultAnswer: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            id: "interaction-1",
            agentJobId: "job-1",
            status: "answered",
            questionType: "choice",
            questionText: "Choose option",
            questionContext: null,
            options: ["Yes", "No"],
            response: "No",
            responseSource: "user",
            answeredAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
            timeoutAction: "continue",
            defaultAnswer: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      },
      channelAdapter: {
        sendMessage: async () => ({ id: "msg-ack", content: "ok" }),
        sendRichMessage: async () => ({ id: "msg-question", content: "question" }),
      },
    });

    await relay.handleOutputEvent({
      type: "question",
      text: "Choose option",
    });

    await relay.handleOutputEvent({
      type: "options",
      options: ["Yes", "No"],
    });

    await waitFor(() => prompts.length === 1);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.prompt).toBe("No");
    expect(polls).toBeGreaterThan(0);
  });

  it("polls interaction for free-text question without options", async () => {
    const prompts: string[] = [];
    let polls = 0;

    const relay = createBidirectionalRelay({
      threadId: "thread-1",
      sessionId: "session-1",
      jobId: "job-1",
      optionsMergeWindowMs: 0,
      timeoutMs: 100,
      pollIntervalMs: 1,
      now: (() => {
        let tick = 0;
        return () => tick++;
      })(),
      sleep: async () => undefined,
      runtime: {
        sendPrompt: async (_sessionId, input) => {
          prompts.push(input.prompt);
          return { ok: true };
        },
      },
      workerClient: {
        createInteraction: async () => ({
          id: "interaction-1",
          agentJobId: "job-1",
          status: "pending",
          questionType: "clarification",
          questionText: "Proceed?",
          questionContext: null,
          options: null,
          response: null,
          responseSource: null,
          answeredAt: null,
          expiresAt: new Date().toISOString(),
          timeoutAction: "continue",
          defaultAnswer: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        pollInteraction: async () => {
          polls += 1;
          if (polls < 2) {
            return {
              id: "interaction-1",
              agentJobId: "job-1",
              status: "pending",
              questionType: "clarification",
              questionText: "Proceed?",
              questionContext: null,
              options: null,
              response: null,
              responseSource: null,
              answeredAt: null,
              expiresAt: new Date().toISOString(),
              timeoutAction: "continue",
              defaultAnswer: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }

          return {
            id: "interaction-1",
            agentJobId: "job-1",
            status: "answered",
            questionType: "clarification",
            questionText: "Proceed?",
            questionContext: null,
            options: null,
            response: "Proceed",
            responseSource: "user",
            answeredAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
            timeoutAction: "continue",
            defaultAnswer: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      },
      channelAdapter: {
        sendMessage: async () => ({ id: "msg-ack", content: "ok" }),
        sendRichMessage: async () => ({ id: "msg-question", content: "question" }),
      },
    });

    await relay.handleOutputEvent({
      type: "question",
      text: "Proceed?",
    });

    await waitFor(() => prompts.length === 1);

    expect(prompts).toEqual(["Proceed"]);
    expect(polls).toBeGreaterThan(0);
  });
});
