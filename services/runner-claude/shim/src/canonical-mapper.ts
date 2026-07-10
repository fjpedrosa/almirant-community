import type { CanonicalEvent, CanonicalMappingResult } from "@almirant/shim-server";
import {
  emitToolSpecificEvents,
  extractInputPreview,
  createSubagentTracker,
  SUBAGENT_TOOLS,
} from "@almirant/shim-server";

type ClaudeEvent = Record<string, unknown>;

// ---- Module-level state (mirrors event-mapper.ts pattern) ----

/** Once true, stream_event deltas have been seen — assistant snapshots are redundant. */
let hasStreamedContent = false;

/** Currently streaming tool_use block (content_block_start → delta → stop). */
let activeToolBlock: { id: string; name: string; inputJson: string } | null = null;

/** Tool call IDs already emitted via stream_event (skip duplicates in assistant). */
const emittedToolCallIds = new Set<string>();

/** Map tool call ID → tool name for matching tool results in `user` events. */
const toolCallNames = new Map<string, string>();

/** Subagent lifecycle tracker. */
const subagentTracker = createSubagentTracker();

// ---- Helpers ----

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const logEvent = (direction: string, eventType: string, detail?: string): void => {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = detail
    ? `[canonical] ${ts} ${direction} ${eventType} | ${detail}`
    : `[canonical] ${ts} ${direction} ${eventType}`;
  console.log(msg);
};

type StructuredQuestion = {
  text: string;
  options: string[];
};

const normalizeQuestionOption = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    const option = value as Record<string, unknown>;
    const label = asString(option.label) ?? asString(option.value) ?? "";
    if (!label) return null;
    const description = asString(option.description);
    return description ? `${label}::${description}` : label;
  }

  return null;
};

const normalizeQuestionOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeQuestionOption)
    .filter((option): option is string => option !== null);
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

      return {
        text,
        options: normalizeQuestionOptions(questionObj.options),
      };
    })
    .filter((question): question is StructuredQuestion => question !== null);
};

// ---- Content extraction from assistant events ----

type ContentBlock = {
  text: string;
  contentType: "thinking" | "text" | "tool_use";
  /** Raw block data for tool_use blocks. */
  toolData?: { name: string; id: string; input: Record<string, unknown> };
};

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
      const toolId = asString(b.id as string);
      if (toolId && emittedToolCallIds.has(toolId)) continue;
      const name = asString(b.name as string) ?? "unknown";
      const input = (typeof b.input === "object" && b.input !== null
        ? b.input
        : {}) as Record<string, unknown>;
      blocks.push({
        text: JSON.stringify({ name, id: toolId, input }),
        contentType: "tool_use",
        toolData: { name, id: toolId ?? `tc-${Date.now()}`, input },
      });
    }
  }

  return blocks;
};

/**
 * Detect AskUserQuestion tool_use in assistant events.
 */
const getAskUserQuestion = (
  event: ClaudeEvent,
): { text: string; options: string[]; questions?: StructuredQuestion[] } | null => {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = message.content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type === "tool_use" && b.name === "AskUserQuestion") {
      const input = b.input as Record<string, unknown> | undefined;
      if (!input) continue;

      const questions = normalizeStructuredQuestions(input.questions);
      const parts = questions.map((question) => question.text);
      const options = questions.flatMap((question) => question.options);

      if (parts.length > 0) {
        return {
          text: parts.join("\n"),
          options,
          ...(questions.length > 0 ? { questions } : {}),
        };
      }
    }
  }

  return null;
};

// ---- Main mapper ----

export const mapClaudeToCanonical = (
  sessionId: string,
  event: ClaudeEvent,
): CanonicalMappingResult => {
  const eventType = asString(event.type) ?? asString(event.event) ?? "";
  const events: CanonicalEvent[] = [];

  // Log incoming event
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

  // ---- stream_event (interactive stream-json mode) ----

  if (eventType === "stream_event") {
    const innerEvent = event.event as Record<string, unknown> | undefined;
    if (!innerEvent) return { events };

    const innerType = asString(innerEvent.type);

    // Tool use: content_block_start with type="tool_use"
    if (innerType === "content_block_start") {
      const contentBlock = innerEvent.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "tool_use") {
        const id = asString(contentBlock.id as string) ?? `tc-${Date.now()}`;
        const name = asString(contentBlock.name as string) ?? "unknown";
        activeToolBlock = { id, name, inputJson: "" };
        emittedToolCallIds.add(id);
        toolCallNames.set(id, name);
        hasStreamedContent = true;

        const preview = extractInputPreview(undefined, "", name);
        events.push({
          kind: "agent.tool_call.start",
          toolName: name,
          toolCallId: id,
          inputPreview: preview,
        });
      }
      return { events };
    }

    // Content deltas
    if (innerType === "content_block_delta") {
      const delta = innerEvent.delta as Record<string, unknown> | undefined;

      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        hasStreamedContent = true;
        events.push({ kind: "agent.text", content: delta.text });
        return { events };
      }

      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        hasStreamedContent = true;
        events.push({ kind: "agent.thinking", content: delta.thinking });
        return { events };
      }

      // Tool use: accumulate input_json_delta
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        if (activeToolBlock) {
          activeToolBlock.inputJson += delta.partial_json;
        }
        return { events };
      }
    }

    // Tool use: content_block_stop — emit specialized tool events
    if (innerType === "content_block_stop") {
      if (activeToolBlock) {
        let parsedInput: Record<string, unknown> | undefined;
        try {
          parsedInput = JSON.parse(activeToolBlock.inputJson) as Record<string, unknown>;
        } catch {
          // Keep parsedInput undefined if JSON is malformed
        }

        const raw = activeToolBlock.inputJson;
        const enrichedPreview = extractInputPreview(
          parsedInput ? { input: parsedInput } : undefined,
          raw,
          activeToolBlock.name,
        );
        if (enrichedPreview && enrichedPreview.length > 0) {
          events.push({
            kind: "agent.tool_call.start",
            toolName: activeToolBlock.name,
            toolCallId: activeToolBlock.id,
            inputPreview: enrichedPreview,
          });
        }

        const toolSpecific = emitToolSpecificEvents(
          activeToolBlock.name,
          activeToolBlock.id,
          parsedInput ? { input: parsedInput } : undefined,
          raw,
        );
        events.push(...toolSpecific);

        // Track subagents
        if (SUBAGENT_TOOLS.has(activeToolBlock.name)) {
          subagentTracker.track(activeToolBlock.id);
        }

        activeToolBlock = null;
      }
      return { events };
    }

    return { events };
  }

  // ---- system event (subtypes: init, api_retry, compact_boundary) ----

  if (eventType === "system") {
    const subtype = asString(event.subtype);

    if (subtype === "api_retry") {
      const attempt = typeof event.attempt === "number" ? event.attempt : "?";
      const maxRetries = typeof event.max_retries === "number" ? event.max_retries : "?";
      const errorCat = asString(event.error) ?? "unknown";
      events.push({
        kind: "system.info",
        message: `Retrying API request (attempt ${attempt}/${maxRetries}, ${errorCat})`,
        metadata: {
          subtype: "api_retry",
          attempt: event.attempt,
          maxRetries: event.max_retries,
          retryDelayMs: event.retry_delay_ms,
          errorStatus: event.error_status,
          errorCategory: event.error,
        },
      });
      return { events };
    }

    if (subtype === "compact_boundary") {
      const meta = event.compact_metadata as Record<string, unknown> | undefined;
      const trigger = asString(meta?.trigger) ?? "auto";
      const preTokens = typeof meta?.pre_tokens === "number" ? meta.pre_tokens : undefined;
      events.push({
        kind: "system.info",
        message: `Context compacted (${trigger}${preTokens ? `, ${preTokens} tokens` : ""})`,
        metadata: { subtype: "compact_boundary", trigger, preTokens },
      });
      return { events };
    }

    // Informational subtypes — no canonical mapping.
    // Verified live against claude-code 2.1.198 (2026-07):
    //   - "status"           {status:"requesting"} progress ping (since 2.1.119)
    //   - "thinking_tokens"  {estimated_tokens,...} heartbeat, NEW in 2.1.198
    //   - "hook_started"/"hook_response"  user-hook lifecycle
    // Emitting session.connected for these would flood consumers mid-turn,
    // so only "init" (or a missing subtype) signals session readiness below.
    if (subtype && subtype !== "init") {
      return { events };
    }

    // init (or missing subtype) → session.connected with metadata
    const initMetadata: Record<string, unknown> = {};
    if (event.model) initMetadata.model = event.model;
    if (event.claude_code_version) initMetadata.claudeCodeVersion = event.claude_code_version;
    if (Array.isArray(event.tools)) initMetadata.toolCount = event.tools.length;
    if (event.permissionMode) initMetadata.permissionMode = event.permissionMode;

    events.push({
      kind: "session.connected",
      ...(Object.keys(initMetadata).length > 0 ? { metadata: initMetadata } : {}),
    });
    return { events };
  }

  // ---- user event (tool results) ----

  if (eventType === "user") {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return { events };

    const content = message.content;
    if (!Array.isArray(content)) return { events };

    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_result") {
        const toolUseId = asString(b.tool_use_id);
        if (!toolUseId) continue;

        const toolName = toolCallNames.get(toolUseId) ?? "unknown";
        const isError = b.is_error === true;

        // Extract output preview from content (may be string or array)
        let outputText = "";
        if (typeof b.content === "string") {
          outputText = b.content;
        } else if (Array.isArray(b.content)) {
          for (const part of b.content) {
            if (typeof part === "object" && part !== null) {
              const p = part as Record<string, unknown>;
              if (p.type === "text" && typeof p.text === "string") {
                outputText += p.text;
              }
            }
          }
        }

        events.push({
          kind: "agent.tool_call.result",
          toolCallId: toolUseId,
          toolName,
          success: !isError,
          outputPreview: outputText.slice(0, 200) || undefined,
        });

        // Complete the subagent at its tool_result (mirrors opencode-shim).
        // complete() self-guards: returns null for non-subagent ids, so this
        // is a no-op for ordinary tools. Background subagents that never
        // return a synchronous result still fall back to completeAll(true)
        // at the terminal `result` event.
        const subagentComplete = subagentTracker.complete(toolUseId, !isError);
        if (subagentComplete) events.push(subagentComplete);
      }
    }

    return { events };
  }

  // ---- assistant event ----

  if (eventType === "assistant") {
    // Check for AskUserQuestion first
    const askQuestion = getAskUserQuestion(event);
    if (askQuestion) {
      events.push({
        kind: "agent.question",
        questionText: askQuestion.text,
        options: askQuestion.options.length > 0 ? askQuestion.options : undefined,
        ...(askQuestion.questions ? { questions: askQuestion.questions } : {}),
      });
      return { events, requiresInput: true };
    }

    const blocks = getAssistantContentBlocks(event);
    for (const block of blocks) {
      // Skip text/thinking if already streamed via stream_event
      if (hasStreamedContent && (block.contentType === "text" || block.contentType === "thinking")) {
        continue;
      }

      if (block.contentType === "text") {
        events.push({ kind: "agent.text", content: block.text });
      } else if (block.contentType === "thinking") {
        events.push({ kind: "agent.thinking", content: block.text });
      } else if (block.contentType === "tool_use" && block.toolData) {
        // Non-streamed tool_use from assistant event
        const { name, id, input } = block.toolData;
        emittedToolCallIds.add(id);
        toolCallNames.set(id, name);

        const raw = JSON.stringify(input);
        const preview = extractInputPreview({ input }, raw, name);
        events.push({
          kind: "agent.tool_call.start",
          toolName: name,
          toolCallId: id,
          inputPreview: preview,
        });

        const toolSpecific = emitToolSpecificEvents(name, id, { input }, raw);
        events.push(...toolSpecific);

        if (SUBAGENT_TOOLS.has(name)) {
          subagentTracker.track(id);
        }
      }
    }

    return { events };
  }

  // ---- result event ----

  if (eventType === "result") {
    const resultText = asString(event.result);
    const subtype = asString(event.subtype);

    if (resultText) {
      events.push({ kind: "agent.text.complete", fullText: resultText });
    }

    // Emit session.error for error result subtypes BEFORE idle
    if (subtype === "error_max_turns") {
      events.push({ kind: "session.error", message: "Session ended: maximum turns exceeded", recoverable: false });
    } else if (subtype === "error_max_budget_usd") {
      events.push({ kind: "session.error", message: "Session ended: budget exhausted", recoverable: false });
    } else if (subtype === "error_during_execution") {
      const errors = Array.isArray(event.errors) ? event.errors.map(String).join("; ") : "";
      events.push({ kind: "session.error", message: `Session ended: runtime error${errors ? ` (${errors})` : ""}`, recoverable: false });
    }

    // Complete all active subagents
    const completions = subagentTracker.completeAll(true);
    events.push(...completions);

    // Clear per-turn state but NOT hasStreamedContent (the critical bug fix)
    emittedToolCallIds.clear();
    activeToolBlock = null;

    // Build result metadata (cost, tokens, duration)
    const resultMetadata: Record<string, unknown> = {};
    if (typeof event.total_cost_usd === "number") resultMetadata.totalCostUsd = event.total_cost_usd;
    if (typeof event.duration_ms === "number") resultMetadata.durationMs = event.duration_ms;
    if (typeof event.duration_api_ms === "number") resultMetadata.durationApiMs = event.duration_api_ms;
    if (typeof event.num_turns === "number") resultMetadata.numTurns = event.num_turns;
    if (event.usage) resultMetadata.usage = event.usage;
    if (event.modelUsage) resultMetadata.modelUsage = event.modelUsage;
    if (subtype) resultMetadata.resultSubtype = subtype;

    // Signal turn completion with metadata
    events.push({
      kind: "session.idle",
      hasBackgroundAgents: false,
      isPlanningJob: false,
      ...(Object.keys(resultMetadata).length > 0 ? { metadata: resultMetadata } : {}),
    });

    return { events, terminal: !!(event.is_final ?? true) };
  }

  // ---- input_required event ----

  if (eventType === "input_required") {
    const questionText =
      asString(event.question) ?? asString(event.prompt) ?? "Input required by Claude";
    const options = Array.isArray(event.options)
      ? event.options.map(String)
      : undefined;

    events.push({
      kind: "agent.question",
      questionText,
      options,
    });
    return { events, requiresInput: true };
  }

  // ---- error events ----

  if (eventType.includes("error")) {
    const message =
      asString(event.error) ?? asString(event.message) ?? "Claude runtime error";
    events.push({ kind: "session.error", message, recoverable: false });
    return { events };
  }

  return { events };
};
