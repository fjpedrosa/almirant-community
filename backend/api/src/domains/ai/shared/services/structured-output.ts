import { z, type ZodType } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiProvider = "openai" | "anthropic" | "google" | "zai" | "xai";

export interface GenerateStructuredJsonParams<T> {
  model: BaseLanguageModel;
  provider: AiProvider;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<T>;
  /** Number of retries on parse/validation failures. Defaults to 2. */
  maxRetries?: number;
}

export interface GenerateStructuredJsonResult<T> {
  result: T;
  tokensUsed: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Defensive stripping of markdown code fences around a JSON payload.
 * Accepts ```json ... ``` or plain ``` ... ``` fences.
 */
const stripMarkdownFences = (raw: string): string => {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  return trimmed;
};

/**
 * Extracts a string content from a LangChain model response.
 * LangChain `invoke` returns an `AIMessage` with `.content` that may be a
 * string or an array of content parts.
 */
const extractStringContent = (response: unknown): string => {
  if (!response || typeof response !== "object") return String(response ?? "");

  const content = (response as { content?: unknown }).content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("");
  }

  return String(content ?? "");
};

/**
 * Best-effort token extraction from a LangChain response. Different providers
 * expose this on different fields:
 *  - OpenAI: `response_metadata.tokenUsage.totalTokens`
 *  - Anthropic: `usage_metadata.total_tokens` (or input+output)
 *  - Some versions: `response_metadata.usage.total_tokens`
 */
const extractTokensUsed = (response: unknown): number => {
  if (!response || typeof response !== "object") return 0;

  const responseRecord = response as Record<string, unknown>;

  // Standard LangChain `usage_metadata`
  const usageMetadata = responseRecord.usage_metadata as
    | Record<string, unknown>
    | undefined;
  if (usageMetadata) {
    const total = usageMetadata.total_tokens;
    if (typeof total === "number") return total;
    const input = usageMetadata.input_tokens;
    const output = usageMetadata.output_tokens;
    if (typeof input === "number" || typeof output === "number") {
      return (typeof input === "number" ? input : 0) +
        (typeof output === "number" ? output : 0);
    }
  }

  // OpenAI/ChatOpenAI `response_metadata.tokenUsage`
  const responseMetadata = responseRecord.response_metadata as
    | Record<string, unknown>
    | undefined;
  if (responseMetadata) {
    const tokenUsage = responseMetadata.tokenUsage as
      | Record<string, unknown>
      | undefined;
    if (tokenUsage) {
      const total = tokenUsage.totalTokens;
      if (typeof total === "number") return total;
      const prompt = tokenUsage.promptTokens;
      const completion = tokenUsage.completionTokens;
      if (typeof prompt === "number" || typeof completion === "number") {
        return (typeof prompt === "number" ? prompt : 0) +
          (typeof completion === "number" ? completion : 0);
      }
    }

    const usage = responseMetadata.usage as
      | Record<string, unknown>
      | undefined;
    if (usage) {
      const total = usage.total_tokens;
      if (typeof total === "number") return total;
      const input = usage.input_tokens;
      const output = usage.output_tokens;
      if (typeof input === "number" || typeof output === "number") {
        return (typeof input === "number" ? input : 0) +
          (typeof output === "number" ? output : 0);
      }
    }
  }

  return 0;
};

/**
 * Sleep with exponential backoff: 100ms, 200ms, 400ms ...
 */
const backoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));

/**
 * Build the messages array, optionally appending a correction hint when
 * the previous attempt failed validation.
 */
const buildMessages = (
  systemPrompt: string,
  userPrompt: string,
  previousError?: string
): Array<SystemMessage | HumanMessage> => {
  const messages: Array<SystemMessage | HumanMessage> = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ];

  if (previousError) {
    messages.push(
      new HumanMessage(
        `Your previous output failed validation: ${previousError}. Correct it and respond with valid JSON only.`
      )
    );
  }

  return messages;
};

// ---------------------------------------------------------------------------
// Provider-specific invocation strategies
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible providers (openai, google, zai, xai) — bind
 * `response_format: json_object` so the model is forced to output JSON.
 */
const invokeOpenAiCompatible = async <T>(
  model: BaseLanguageModel,
  messages: Array<SystemMessage | HumanMessage>,
  schema: ZodType<T>
): Promise<{ parsed: T; tokensUsed: number }> => {
  const bindable = model as BaseLanguageModel & {
    bind?: (kwargs: Record<string, unknown>) => BaseLanguageModel;
  };

  const boundModel =
    typeof bindable.bind === "function"
      ? bindable.bind({ response_format: { type: "json_object" } })
      : model;

  const response = await boundModel.invoke(messages);
  const rawContent = extractStringContent(response);
  const cleaned = stripMarkdownFences(rawContent);

  const jsonValue = JSON.parse(cleaned) as unknown;
  const parsed = schema.parse(jsonValue);

  return { parsed, tokensUsed: extractTokensUsed(response) };
};

/**
 * Anthropic — use `withStructuredOutput` with function calling mode.
 * It returns the parsed object directly (no JSON.parse needed) but we still
 * pass it through `schema.parse` as a safety net.
 */
const invokeAnthropic = async <T>(
  model: BaseLanguageModel,
  messages: Array<SystemMessage | HumanMessage>,
  schema: ZodType<T>
): Promise<{ parsed: T; tokensUsed: number }> => {
  const structurable = model as BaseLanguageModel & {
    withStructuredOutput?: (
      schema: unknown,
      options?: { method?: string; name?: string }
    ) => {
      invoke: (input: unknown) => Promise<unknown>;
    };
  };

  if (typeof structurable.withStructuredOutput !== "function") {
    // Should never happen with ChatAnthropic, but gracefully fall back.
    return invokeFallback(model, messages, schema);
  }

  const structured = structurable.withStructuredOutput(schema, {
    method: "function_calling",
    name: "structured_output",
  });

  const response = await structured.invoke(messages);

  // `withStructuredOutput` returns the parsed object; re-validate defensively.
  const parsed = schema.parse(response);

  // `withStructuredOutput` strips metadata from the response — token usage is
  // not exposed here. Report 0 rather than fail.
  return { parsed, tokensUsed: 0 };
};

/**
 * Fallback — plain invocation + markdown stripping + JSON.parse + Zod.
 */
const invokeFallback = async <T>(
  model: BaseLanguageModel,
  messages: Array<SystemMessage | HumanMessage>,
  schema: ZodType<T>
): Promise<{ parsed: T; tokensUsed: number }> => {
  const response = await model.invoke(messages);
  const rawContent = extractStringContent(response);
  const cleaned = stripMarkdownFences(rawContent);

  const jsonValue = JSON.parse(cleaned) as unknown;
  const parsed = schema.parse(jsonValue);

  return { parsed, tokensUsed: extractTokensUsed(response) };
};

/**
 * Dispatch to the right strategy, with a fallback on unsupported APIs.
 */
const invokeForProvider = async <T>(
  provider: AiProvider,
  model: BaseLanguageModel,
  messages: Array<SystemMessage | HumanMessage>,
  schema: ZodType<T>
): Promise<{ parsed: T; tokensUsed: number }> => {
  try {
    switch (provider) {
      case "openai":
      case "google":
      case "zai":
      case "xai":
        return await invokeOpenAiCompatible(model, messages, schema);
      case "anthropic":
        return await invokeAnthropic(model, messages, schema);
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unsupported provider: ${_exhaustive as string}`);
      }
    }
  } catch (err) {
    // If the provider-native strategy fails structurally (e.g. the model
    // refused `response_format`), try the fallback once. We only fall back on
    // non-Zod, non-parse errors — Zod/parse failures are handled by the retry
    // loop in `generateStructuredJson`.
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      throw err;
    }
    logger.warn(
      { err, provider },
      "Provider-native structured output failed, using fallback"
    );
    return invokeFallback(model, messages, schema);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a JSON payload from an LLM that is guaranteed to satisfy the given
 * Zod schema (or throw after exhausting retries).
 *
 * Strategy:
 *  - openai / google / zai / xai → `response_format: { type: "json_object" }`
 *  - anthropic                   → `withStructuredOutput(schema, { method: "function_calling" })`
 *  - If a provider-native call fails unexpectedly, falls back to plain invoke
 *    + markdown fence stripping + `JSON.parse` + `schema.parse`.
 *
 * On parse/validation failure, retries with an additional human message
 * informing the model of the validation error (default 2 retries).
 *
 * Zod / JSON parse errors are logged internally but never surfaced to the
 * caller beyond the final thrown error message.
 */
export const generateStructuredJson = async <T>(
  params: GenerateStructuredJsonParams<T>
): Promise<GenerateStructuredJsonResult<T>> => {
  const {
    model,
    provider,
    systemPrompt,
    userPrompt,
    schema,
    maxRetries = 2,
  } = params;

  const start = Date.now();

  let lastValidationError: string | undefined;
  let lastError: unknown;
  let tokensUsed = 0;

  // Total attempts = 1 initial + maxRetries
  const totalAttempts = 1 + Math.max(0, maxRetries);

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const messages = buildMessages(systemPrompt, userPrompt, lastValidationError);

    try {
      const { parsed, tokensUsed: t } = await invokeForProvider(
        provider,
        model,
        messages,
        schema
      );

      tokensUsed += t;

      return {
        result: parsed,
        tokensUsed,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof z.ZodError) {
        lastValidationError = err.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        logger.warn(
          { attempt, validationError: lastValidationError },
          "Structured output failed Zod validation; will retry"
        );
      } else if (err instanceof SyntaxError) {
        lastValidationError = `Output was not valid JSON: ${err.message}`;
        logger.warn(
          { attempt, err: err.message },
          "Structured output failed JSON.parse; will retry"
        );
      } else {
        // Non-validation error (network, auth, etc.) — do not retry here,
        // surface immediately so `withAuthErrorDetection` can handle auth.
        logger.error(
          { attempt, err },
          "Structured output failed with non-validation error"
        );
        throw err;
      }

      if (attempt < totalAttempts - 1) {
        await backoff(attempt);
      }
    }
  }

  // Exhausted retries — throw a generic error; DO NOT leak Zod details to
  // end users. The detailed `lastValidationError` is already in the logs.
  logger.error(
    { attempts: totalAttempts, lastValidationError, lastError },
    "Structured output exhausted retries"
  );
  throw new Error(
    `Failed to generate valid structured JSON after ${totalAttempts} attempts`
  );
};
