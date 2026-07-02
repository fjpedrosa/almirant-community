import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { generateStructuredJson } from "./structured-output";

// ---------------------------------------------------------------------------
// Test schema
// ---------------------------------------------------------------------------

const testSchema = z.object({
  title: z.string(),
  count: z.number(),
});

type TestPayload = z.infer<typeof testSchema>;

// ---------------------------------------------------------------------------
// Mock model factory
// ---------------------------------------------------------------------------

interface MockResponse {
  content: string;
  response_metadata?: Record<string, unknown>;
  usage_metadata?: Record<string, unknown>;
}

interface MockModelOptions {
  /** Sequence of responses for successive invocations (OpenAI-compatible path). */
  invokeResponses?: MockResponse[];
  /** Sequence of responses for successive `withStructuredOutput(...)` invocations. */
  structuredResponses?: unknown[];
  /** Whether to support `bind`. Defaults to true. */
  supportsBind?: boolean;
  /** Whether to support `withStructuredOutput`. Defaults to true. */
  supportsStructuredOutput?: boolean;
}

interface MockModelHandle {
  model: BaseLanguageModel;
  invokeCount: () => number;
  structuredInvokeCount: () => number;
  lastMessages: () => unknown;
}

const createMockModel = (opts: MockModelOptions): MockModelHandle => {
  const {
    invokeResponses = [],
    structuredResponses = [],
    supportsBind = true,
    supportsStructuredOutput = true,
  } = opts;

  let invokeIndex = 0;
  let structuredIndex = 0;
  let lastMessages: unknown = null;

  const invoke = async (messages: unknown): Promise<MockResponse> => {
    lastMessages = messages;
    if (invokeIndex >= invokeResponses.length) {
      throw new Error(`Mock ran out of invokeResponses at index ${invokeIndex}`);
    }
    const r = invokeResponses[invokeIndex]!;
    invokeIndex++;
    return r;
  };

  const model: Record<string, unknown> = { invoke };

  if (supportsBind) {
    model.bind = (_kwargs: Record<string, unknown>) => ({ invoke });
  }

  if (supportsStructuredOutput) {
    model.withStructuredOutput = (_schema: unknown) => ({
      invoke: async (messages: unknown) => {
        lastMessages = messages;
        if (structuredIndex >= structuredResponses.length) {
          throw new Error(
            `Mock ran out of structuredResponses at index ${structuredIndex}`
          );
        }
        const r = structuredResponses[structuredIndex];
        structuredIndex++;
        return r;
      },
    });
  }

  return {
    model: model as unknown as BaseLanguageModel,
    invokeCount: () => invokeIndex,
    structuredInvokeCount: () => structuredIndex,
    lastMessages: () => lastMessages,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateStructuredJson", () => {
  it("OpenAI path: returns parsed JSON and tokens from response_metadata", async () => {
    const handle = createMockModel({
      invokeResponses: [
        {
          content: JSON.stringify({ title: "hello", count: 3 }),
          response_metadata: { tokenUsage: { totalTokens: 42 } },
        },
      ],
    });

    const { result, tokensUsed, latencyMs } = await generateStructuredJson<TestPayload>({
      model: handle.model,
      provider: "openai",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
    });

    expect(result).toEqual({ title: "hello", count: 3 });
    expect(tokensUsed).toBe(42);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(handle.invokeCount()).toBe(1);
  });

  it("Anthropic path: uses withStructuredOutput and skips JSON.parse", async () => {
    const handle = createMockModel({
      structuredResponses: [{ title: "anthropic-ok", count: 7 }],
    });

    const { result, tokensUsed } = await generateStructuredJson<TestPayload>({
      model: handle.model,
      provider: "anthropic",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
    });

    expect(result).toEqual({ title: "anthropic-ok", count: 7 });
    expect(tokensUsed).toBe(0);
    expect(handle.structuredInvokeCount()).toBe(1);
    expect(handle.invokeCount()).toBe(0);
  });

  it("Invalid JSON on first attempt triggers a retry and succeeds on second", async () => {
    const handle = createMockModel({
      invokeResponses: [
        // First attempt: not JSON at all
        { content: "not-json-at-all" },
        // Second attempt: valid
        {
          content: JSON.stringify({ title: "recovered", count: 1 }),
          usage_metadata: { total_tokens: 10 },
        },
      ],
    });

    const { result, tokensUsed } = await generateStructuredJson<TestPayload>({
      model: handle.model,
      provider: "openai",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
      maxRetries: 2,
    });

    expect(result).toEqual({ title: "recovered", count: 1 });
    expect(tokensUsed).toBe(10);
    expect(handle.invokeCount()).toBe(2);

    // The retry message must include the validation error hint
    const messages = handle.lastMessages() as Array<{ content: string }>;
    const lastMsg = messages[messages.length - 1]!;
    expect(lastMsg.content).toContain("previous output failed validation");
  });

  it("Max retries exceeded: throws a generic error without leaking Zod details", async () => {
    const handle = createMockModel({
      invokeResponses: [
        { content: "garbage-1" },
        { content: "garbage-2" },
        { content: "garbage-3" },
      ],
    });

    const promise = generateStructuredJson<TestPayload>({
      model: handle.model,
      provider: "openai",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
      maxRetries: 2,
    });

    await expect(promise).rejects.toThrow(/Failed to generate valid structured JSON/);

    // 1 initial + 2 retries = 3 total
    expect(handle.invokeCount()).toBe(3);
  });

  it("Strips markdown code fences before parsing", async () => {
    const handle = createMockModel({
      invokeResponses: [
        {
          content:
            "```json\n" +
            JSON.stringify({ title: "fenced", count: 9 }) +
            "\n```",
        },
      ],
    });

    const { result } = await generateStructuredJson<TestPayload>({
      model: handle.model,
      provider: "openai",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
    });

    expect(result).toEqual({ title: "fenced", count: 9 });
  });

  // IMPORTANT 3 (root cause): a hung provider call must not leave the caller
  // (the effort-estimation sweeper) blocked forever. generateStructuredJson must
  // bound each attempt with a timeout, abort the underlying request via the
  // AbortSignal, and reject rather than retry indefinitely.
  it(
    "aborts and rejects when the model call exceeds the timeout",
    async () => {
      let aborted = false;

      const hangingInvoke = (
        _messages: unknown,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
          // Never resolves on its own — only the timeout/abort ends it.
        });

      const model = {
        bind: () => ({ invoke: hangingInvoke }),
        invoke: hangingInvoke,
      } as unknown as BaseLanguageModel;

      const promise = generateStructuredJson<TestPayload>({
        model,
        provider: "openai",
        systemPrompt: "sys",
        userPrompt: "user",
        schema: testSchema,
        maxRetries: 2,
        timeoutMs: 50,
      });

      await expect(promise).rejects.toThrow(/timed out/i);
      expect(aborted).toBe(true);
    },
    2000,
  );

  it("Surfaces non-validation errors immediately without retrying", async () => {
    let calls = 0;
    const model = {
      bind: () => ({
        invoke: async () => {
          calls++;
          throw new Error("401 unauthorized");
        },
      }),
      invoke: async () => {
        calls++;
        throw new Error("401 unauthorized");
      },
    } as unknown as BaseLanguageModel;

    const promise = generateStructuredJson<TestPayload>({
      model,
      provider: "openai",
      systemPrompt: "sys",
      userPrompt: "user",
      schema: testSchema,
      maxRetries: 2,
    });

    await expect(promise).rejects.toThrow(/401 unauthorized/);
    // 1 bound call + 1 fallback call on the same attempt; no retry loop
    // iteration because the error is not a Zod / JSON error.
    expect(calls).toBe(2);
  });
});
