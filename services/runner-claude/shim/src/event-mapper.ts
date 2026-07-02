import type { SSEEvent } from "@almirant/shim-server";

type ClaudeEvent = Record<string, unknown>;

type MappingResult = {
  events: SSEEvent[];
  deltaText?: string;
  snapshotText?: string;
  requiresInput?: boolean;
};

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getTextFromEvent = (event: ClaudeEvent): string | undefined => {
  const direct = asString(event.text) ?? asString(event.delta) ?? asString(event.content);
  if (direct) {
    return direct;
  }

  if (typeof event.message === "object" && event.message !== null) {
    const message = event.message as Record<string, unknown>;
    return asString(message.text) ?? asString(message.content);
  }

  return undefined;
};

type ContentBlock = {
  text: string;
  contentType: "thinking" | "text" | "tool_use";
};

type StructuredQuestion = {
  text: string;
  options: string[];
};

type AskUserQuestionPayload = {
  toolId?: string;
  text: string;
  options: string[];
  questions?: StructuredQuestion[];
};

const normalizeQuestionOption = (value: unknown): string | null => {
  if (typeof value === "string") return value;

  if (typeof value === "object" && value !== null) {
    const option = value as Record<string, unknown>;
    const label = asString(option.label) ?? asString(option.value) ?? "";
    if (!label) return null;
    const description = asString(option.description);
    return description ? `${label}::${description}` : label;
  }

  return null;
};

const normalizeStructuredQuestions = (value: unknown): StructuredQuestion[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((question) => {
      if (typeof question !== "object" || question === null) return null;
      const questionObj = question as Record<string, unknown>;
      const text =
        asString(questionObj.question) ?? asString(questionObj.text) ?? "";
      if (!text) return null;

      const options = Array.isArray(questionObj.options)
        ? questionObj.options
            .map(normalizeQuestionOption)
            .filter((option): option is string => option !== null)
        : [];

      return { text, options };
    })
    .filter((question): question is StructuredQuestion => question !== null);
};

const getAskUserQuestionFromInput = (
  input: unknown,
  toolId?: string,
): AskUserQuestionPayload | null => {
  if (typeof input !== "object" || input === null) return null;

  const inputObj = input as Record<string, unknown>;
  const questions = normalizeStructuredQuestions(inputObj.questions);
  const parts = questions.map((question) => question.text);
  const options = questions.flatMap((question) => question.options);

  if (parts.length === 0) return null;

  return {
    ...(toolId ? { toolId } : {}),
    text: parts.join("\n"),
    options,
    ...(questions.length > 0 ? { questions } : {}),
  };
};

/**
 * Extract content blocks from a Claude CLI "assistant" event.
 * The message.content array may contain text and thinking blocks.
 * Each block is returned with its contentType so callers can emit
 * separate SSE events per block.
 */
const getAssistantContentBlocks = (event: ClaudeEvent): ContentBlock[] => {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content;
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;

    const b = block as Record<string, unknown>;

    if (b.type === "text") {
      const text = asString(b.text);
      if (text) blocks.push({ text, contentType: "text" });
    } else if (b.type === "thinking") {
      const text = asString(b.thinking);
      if (text) blocks.push({ text, contentType: "thinking" });
    } else if (b.type === "tool_use") {
      // Skip tool_use blocks already emitted during streaming (via content_block_start/stop)
      const toolId = asString(b.id as string);
      if (toolId && emittedToolCallIds.has(toolId)) continue;
      // Emit tool_use blocks as JSON so the sse-canonical-adapter can detect
      // tool call transitions and generate canonical events (agent.tool_call.start,
      // agent.file.read, agent.bash.execute, etc.)
      const toolJson = JSON.stringify({ name: b.name, id: b.id, input: b.input });
      blocks.push({ text: toolJson, contentType: "tool_use" });
    }
    // AskUserQuestion is handled separately by getAskUserQuestion()
  }

  return blocks;
};

/**
 * Extract AskUserQuestion tool_use blocks from the assistant event.
 * Returns the question text and options array if found.
 */
const getAskUserQuestion = (
  event: ClaudeEvent
): AskUserQuestionPayload | null => {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = message.content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type === "tool_use" && b.name === "AskUserQuestion") {
      const toolId = asString(b.id);
      if (toolId && emittedQuestionToolIds.has(toolId)) continue;

      const question = getAskUserQuestionFromInput(b.input, toolId);
      if (question) {
        return question;
      }
    }
  }

  return null;
};

// Track the currently streaming tool_use block across content_block_start → delta → stop
let activeToolBlock: { id: string; name: string; inputJson: string } | null = null;
// Track tool IDs already emitted via stream_event to skip duplicates in the `assistant` event
const emittedToolCallIds = new Set<string>();
// Track AskUserQuestion tool IDs already emitted as question.asked to avoid duplicates
const emittedQuestionToolIds = new Set<string>();
// When true, content was already streamed via stream_event — the `assistant` event is a redundant snapshot
let hasStreamedContent = false;

/** Log all events for debugging — written to stdout so container logs capture them. */
const logEvent = (direction: string, eventType: string, detail?: string): void => {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = detail ? `[shim-events] ${ts} ${direction} ${eventType} | ${detail}` : `[shim-events] ${ts} ${direction} ${eventType}`;
  console.log(msg);
};

export const mapClaudeEventToSse = (
  sessionId: string,
  event: ClaudeEvent
): MappingResult => {
  const eventType = asString(event.type) ?? asString(event.event) ?? "";
  const events: SSEEvent[] = [];

  // Log incoming Claude Code event
  if (eventType !== "stream_event") {
    logEvent("IN ", eventType);
  } else {
    const inner = event.event as Record<string, unknown> | undefined;
    const innerType = asString(inner?.type);
    if (innerType === "content_block_start") {
      const cb = inner?.content_block as Record<string, unknown> | undefined;
      logEvent("IN ", `stream_event:${innerType}`, `block_type=${cb?.type ?? "?"} name=${cb?.name ?? "-"}`);
    } else if (innerType === "content_block_delta") {
      const delta = inner?.delta as Record<string, unknown> | undefined;
      logEvent("IN ", `stream_event:${innerType}`, `delta_type=${delta?.type ?? "?"}`);
    } else if (innerType) {
      logEvent("IN ", `stream_event:${innerType}`);
    }
  }

  // Interactive stream-json mode: type="stream_event" wraps inner Claude API events
  if (eventType === "stream_event") {
    const innerEvent = event.event as Record<string, unknown> | undefined;
    if (!innerEvent) return { events };

    const innerType = asString(innerEvent.type);

    // Tool use: content_block_start with type="tool_use" — emit immediately for real-time visibility
    if (innerType === "content_block_start") {
      const contentBlock = innerEvent.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "tool_use") {
        const id = asString(contentBlock.id as string) ?? `tc-${Date.now()}`;
        const name = asString(contentBlock.name as string) ?? "unknown";
        activeToolBlock = { id, name, inputJson: "" };
        emittedToolCallIds.add(id);
        hasStreamedContent = true;
        events.push({
          type: "message.part.delta",
          properties: {
            sessionId,
            delta: JSON.stringify({ name, id }),
            contentType: "tool_use",
          },
        });
      }
      return { events };
    }

    if (innerType === "content_block_delta") {
      const delta = innerEvent.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        hasStreamedContent = true;
        events.push({
          type: "message.part.delta",
          properties: { sessionId, delta: delta.text, contentType: "text" },
        });
        return { events, deltaText: delta.text };
      }
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        hasStreamedContent = true;
        events.push({
          type: "message.part.delta",
          properties: { sessionId, delta: delta.thinking, contentType: "thinking" },
        });
        return { events, deltaText: delta.thinking };
      }
      // Tool use: accumulate input_json_delta into activeToolBlock
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        if (activeToolBlock) {
          activeToolBlock.inputJson += delta.partial_json;
        }
        return { events };
      }
    }

    // Tool use: content_block_stop — emit complete tool_use with full input
    if (innerType === "content_block_stop") {
      if (activeToolBlock) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(activeToolBlock.inputJson); } catch {}
        events.push({
          type: "message.part.delta",
          properties: {
            sessionId,
            delta: JSON.stringify({
              name: activeToolBlock.name,
              id: activeToolBlock.id,
              input: parsedInput,
            }),
            contentType: "tool_use",
          },
        });
        if (activeToolBlock.name === "AskUserQuestion") {
          const askQuestion = getAskUserQuestionFromInput(parsedInput, activeToolBlock.id);
          if (askQuestion) {
            emittedQuestionToolIds.add(activeToolBlock.id);
            events.push({
              type: "question.asked",
              properties: {
                sessionId,
                ...(askQuestion.toolId ? { toolCallId: askQuestion.toolId } : {}),
                text: askQuestion.text,
                options: askQuestion.options.length > 0 ? askQuestion.options : undefined,
                ...(askQuestion.questions ? { questions: askQuestion.questions } : {}),
              },
            });
            activeToolBlock = null;
            return { events, requiresInput: true };
          }
        }
        activeToolBlock = null;
      }
      return { events };
    }

    return { events };
  }

  // Interactive stream-json mode: type="system" signals session readiness.
  // Only subtype "init" (or a missing subtype) marks readiness. Informational
  // subtypes verified live against claude-code 2.1.198: "status" (progress
  // ping, since 2.1.119), "thinking_tokens" (NEW in 2.1.198), and
  // "hook_started"/"hook_response" — none of them should emit SSE noise.
  if (eventType === "system") {
    const subtype = asString(event.subtype);
    if (subtype && subtype !== "init") {
      return { events };
    }
    events.push({
      type: "session.status",
      properties: { sessionId, status: "running", message: "Session initialized" },
    });
    return { events };
  }

  // Claude CLI v2.1.71+ stream-json format: type="assistant" with message.content[]
  if (eventType === "assistant") {
    const blocks = getAssistantContentBlocks(event);
    let deltaText = "";

    if (blocks.length > 0) {
      for (const block of blocks) {
        // When content was already streamed via stream_event (--include-partial-messages),
        // the assistant event is a redundant snapshot. Skip text/thinking to avoid duplication.
        if (hasStreamedContent && (block.contentType === "text" || block.contentType === "thinking")) {
          continue;
        }
        events.push({
          type: "message.part.delta",
          properties: {
            sessionId,
            delta: block.text,
            contentType: block.contentType,
          },
        });
        deltaText += block.text;
      }
    }

    // Check for AskUserQuestion tool_use — emit as question.asked
    const askQuestion = getAskUserQuestion(event);
    if (askQuestion) {
      if (askQuestion.toolId) {
        emittedQuestionToolIds.add(askQuestion.toolId);
      }
      events.push({
        type: "question.asked",
        properties: {
          sessionId,
          ...(askQuestion.toolId ? { toolCallId: askQuestion.toolId } : {}),
          text: askQuestion.text,
          options: askQuestion.options.length > 0 ? askQuestion.options : undefined,
          ...(askQuestion.questions ? { questions: askQuestion.questions } : {}),
        },
      });
      return { events, deltaText: deltaText || undefined, requiresInput: true };
    }

    if (deltaText) {
      return { events, deltaText };
    }
  }

  // Claude CLI v2.1.71+ stream-json format: type="result" with result string
  if (eventType === "result") {
    const resultText = asString(event.result);
    if (resultText) {
      events.push({
        type: "message.part.updated",
        properties: {
          sessionId,
          part: {
            text: resultText,
          },
          contentType: "text",
        },
      });
    }
    // Clear per-turn state but NOT hasStreamedContent — assistant snapshots
    // arriving before stream_event deltas in the next turn must still be skipped
    emittedToolCallIds.clear();
    emittedQuestionToolIds.clear();
    activeToolBlock = null;
    // Always signal turn completion — even with empty result (e.g. AskUserQuestion in -p mode)
    return { events, snapshotText: resultText ?? "" };
  }

  // Legacy format: assistant.text.delta
  if (eventType === "assistant.text.delta") {
    const delta = getTextFromEvent(event);
    if (delta) {
      events.push({
        type: "message.part.delta",
        properties: {
          sessionId,
          delta,
          contentType: "text",
        },
      });
      return { events, deltaText: delta };
    }
  }

  // Legacy format: assistant.text.done
  if (eventType === "assistant.text.done") {
    const snapshot = getTextFromEvent(event);
    if (snapshot) {
      events.push({
        type: "message.part.updated",
        properties: {
          sessionId,
          part: {
            text: snapshot,
          },
          contentType: "text",
        },
      });
      return { events, snapshotText: snapshot };
    }
  }

  if (eventType === "input_required") {
    const questionText =
      asString(event.question) ?? asString(event.prompt) ?? "Input required by Claude";
    const options = Array.isArray(event.options)
      ? event.options.map(String)
      : undefined;

    events.push({
      type: "question.asked",
      properties: {
        sessionId,
        text: questionText,
        options,
      },
    });

    return { events, requiresInput: true };
  }

  if (eventType.includes("error")) {
    const message =
      asString(event.error) ?? asString(event.message) ?? "Claude runtime error";
    events.push({
      type: "session.status",
      properties: {
        sessionId,
        status: "error",
        message,
      },
    });
    return { events };
  }

  if (eventType === "session.status") {
    events.push({
      type: "session.status",
      properties: {
        sessionId,
        status: asString(event.status) ?? "running",
        message: asString(event.message),
      },
    });
    return { events };
  }

  return { events };
};
