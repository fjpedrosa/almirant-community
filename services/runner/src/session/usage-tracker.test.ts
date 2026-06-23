import { describe, expect, test } from "bun:test";
import { createSessionUsageTracker, extractUsageFromEvent } from "./usage-tracker";

describe("extractUsageFromEvent", () => {
  test("reads direct step-finish token fields", () => {
    expect(
      extractUsageFromEvent("step-finish", {
        input_tokens: 120,
        output_tokens: 45,
        model: "gpt-5.4",
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      model: "gpt-5.4",
    });
  });

  test("reads nested token objects emitted by some runtimes", () => {
    expect(
      extractUsageFromEvent("step-finish", {
        tokens: {
          input: 10,
          output: 4,
        },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 4,
    });

    expect(
      extractUsageFromEvent("message.completed", {
        usage: {
          prompt_tokens: 33,
          completion_tokens: 12,
        },
      }),
    ).toEqual({
      inputTokens: 33,
      outputTokens: 12,
    });
  });
});

describe("createSessionUsageTracker", () => {
  test("accumulates step-finish usage and ignores duplicated message summaries", () => {
    const tracker = createSessionUsageTracker();

    tracker.trackEvent("step-finish", {
      input_tokens: 100,
      output_tokens: 20,
      model: "gpt-5.4",
    });
    tracker.trackEvent("step-finish", {
      usage: {
        prompt_tokens: 40,
        completion_tokens: 10,
      },
    });

    // Some runtimes also include the final message usage summary. Once
    // step-finish usage exists, that summary should not be counted again.
    tracker.trackEvent("message.completed", {
      usage: {
        prompt_tokens: 140,
        completion_tokens: 30,
      },
    });

    expect(tracker.getSummary()).toEqual({
      inputTokens: 140,
      outputTokens: 30,
      tokensUsed: 170,
      model: "gpt-5.4",
    });
  });

  test("uses message.updated/message.completed deltas when step-finish is unavailable", () => {
    const tracker = createSessionUsageTracker();

    tracker.trackEvent("message.updated", {
      usage: {
        input_tokens: 10,
        output_tokens: 2,
      },
    });
    tracker.trackEvent("message.updated", {
      usage: {
        input_tokens: 14,
        output_tokens: 5,
      },
    });
    tracker.trackEvent("message.completed", {
      usage: {
        input_tokens: 18,
        output_tokens: 6,
      },
      model: "claude-sonnet-4-5",
    });

    // Next assistant turn must start from zero again after message.completed.
    tracker.trackEvent("message.completed", {
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
      },
    });

    expect(tracker.getSummary()).toEqual({
      inputTokens: 25,
      outputTokens: 9,
      tokensUsed: 34,
      model: "claude-sonnet-4-5",
    });
  });
});
