import type {
  CanonicalEvent,
  CanonicalMappingResult,
  SubagentTracker,
} from "@almirant/shim-server";
import {
  emitToolSpecificEvents,
  extractInputPreview,
  createSubagentTracker,
  normalizeToolName,
  SUBAGENT_TOOLS,
} from "@almirant/shim-server";

// ---------------------------------------------------------------------------
// OpenCode SSE → CanonicalEvent mapper
//
// Receives OpenCode native SSE events and produces CanonicalEvent[] directly,
// bypassing the intermediate SSEEvent representation.
//
// Handles ALL Part types from OpenCode's message.part.updated events:
//   TextPart, ReasoningPart, ToolPart, AgentPart, SubtaskPart,
//   StepStartPart, StepFinishPart, FilePart, PatchPart, RetryPart
// ---------------------------------------------------------------------------

export type OpenCodeCanonicalContext = {
  /** Accumulated text per part ID for delta extraction. */
  partSnapshots: Map<string, string>;
  /** OpenCode partID → canonical content type learned from message.part.updated. */
  partContentTypes: Map<string, "thinking" | "text" | "tool_use">;
  /** Accumulated JSON buffer per part ID for tool_use parsing. */
  toolUseBuffers: Map<string, string>;
  /** Subagent lifecycle tracker. */
  subagentTracker: SubagentTracker;
  /** Active tool calls (toolCallId → toolName) for result emission on idle. */
  activeTools: Map<string, { toolName: string }>;
  /** Tool call IDs already emitted to avoid duplicate tool_call.start events. */
  emittedToolIds: Set<string>;
};

export const createCanonicalContext = (): OpenCodeCanonicalContext => ({
  partSnapshots: new Map(),
  partContentTypes: new Map(),
  toolUseBuffers: new Map(),
  subagentTracker: createSubagentTracker(),
  activeTools: new Map(),
  emittedToolIds: new Set(),
});

// ---- Helpers ----

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Map OpenCode partType to standard contentType. */
const normalizeContentType = (
  partType: string | undefined,
): "thinking" | "text" | "tool_use" | undefined => {
  if (!partType) return undefined;
  if (partType === "reasoning") return "thinking";
  if (partType === "tool") return "tool_use";
  if (partType === "text" || partType === "thinking" || partType === "tool_use") {
    return partType as "text" | "thinking" | "tool_use";
  }
  return undefined;
};

/**
 * Resolve a part identifier from the event properties.
 * OpenCode uses `partID` (sometimes `partId`) to distinguish parts within
 * the same message. Falls back to `messageID`+`field` composite key.
 */
const resolvePartId = (props: Record<string, unknown>): string => {
  const partId = asString(props.partID) ?? asString(props.partId);
  if (partId) return partId;
  const messageId = asString(props.messageID) ?? asString(props.messageId) ?? "";
  const field = asString(props.field) ?? "text";
  return `${messageId}:${field}`;
};

/** Try to parse accumulated JSON for a tool_use buffer. */
const tryParseToolUse = (
  raw: string,
): { toolName: string; toolCallId: string; parsed?: Record<string, unknown> } | null => {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return null;
    const toolName =
      typeof obj.name === "string" ? obj.name :
      typeof obj.tool_name === "string" ? obj.tool_name :
      typeof obj.toolName === "string" ? obj.toolName : undefined;
    const toolCallId =
      typeof obj.id === "string" ? obj.id :
      typeof obj.tool_call_id === "string" ? obj.tool_call_id :
      typeof obj.toolCallId === "string" ? obj.toolCallId : undefined;
    if (!toolName) return null;
    return {
      toolName: normalizeToolName(toolName),
      toolCallId: toolCallId ?? `tool_${Date.now()}`,
      parsed: obj,
    };
  } catch {
    return null;
  }
};

/** Safely extract a nested object from props. */
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

// ---- ToolPart handler ----

/**
 * Handle a ToolPart from message.part.updated.
 * ToolPart has: { type: "tool", callID, tool, state: { status, input, ... } }
 */
const handleToolPart = (
  partId: string,
  part: Record<string, unknown>,
  context: OpenCodeCanonicalContext,
): CanonicalMappingResult => {
  const events: CanonicalEvent[] = [];

  const toolName = normalizeToolName(asString(part.tool) ?? asString(part.name) ?? "unknown");
  const toolCallId = asString(part.callID) ?? asString(part.id) ?? partId;
  const state = asObject(part.state);
  if (!state) return { events };

  const status = asString(state.status);
  const input = asObject(state.input);
  const rawInput = input ? JSON.stringify(input) : "";

  switch (status) {
    case "pending": {
      // Tool call declared but not yet executing
      if (!context.emittedToolIds.has(toolCallId)) {
        const preview = extractInputPreview(input ? { input } : undefined, rawInput, toolName);
        events.push({
          kind: "agent.tool_call.start",
          toolName,
          toolCallId,
          inputPreview: preview,
        });
        context.emittedToolIds.add(toolCallId);
      }
      context.activeTools.set(toolCallId, { toolName });
      break;
    }

    case "running": {
      // Tool is executing — emit start (possibly enriched) + tool-specific events
      const preview = extractInputPreview(input ? { input } : undefined, rawInput, toolName);
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview: preview,
      });
      context.emittedToolIds.add(toolCallId);
      context.activeTools.set(toolCallId, { toolName });

      // Emit specialized events (file.read, bash.execute, subagent.spawn, etc.)
      const toolSpecific = emitToolSpecificEvents(
        toolName,
        toolCallId,
        input ? { input } : undefined,
        rawInput,
      );
      events.push(...toolSpecific);

      // Track subagents
      if (SUBAGENT_TOOLS.has(toolName)) {
        context.subagentTracker.track(toolCallId);
      }
      break;
    }

    case "completed": {
      const output = asString(state.output);
      // If we haven't emitted start yet, emit it now with full input
      if (!context.emittedToolIds.has(toolCallId)) {
        const preview = extractInputPreview(input ? { input } : undefined, rawInput, toolName);
        events.push({
          kind: "agent.tool_call.start",
          toolName,
          toolCallId,
          inputPreview: preview,
        });

        // Also emit tool-specific events
        const toolSpecific = emitToolSpecificEvents(
          toolName,
          toolCallId,
          input ? { input } : undefined,
          rawInput,
        );
        events.push(...toolSpecific);

        if (SUBAGENT_TOOLS.has(toolName)) {
          context.subagentTracker.track(toolCallId);
        }
      }

      events.push({
        kind: "agent.tool_call.result",
        toolCallId,
        toolName,
        success: true,
        outputPreview: output?.slice(0, 200),
      });

      // Complete subagent if applicable
      const subagentComplete = context.subagentTracker.complete(toolCallId, true);
      if (subagentComplete) events.push(subagentComplete);

      context.activeTools.delete(toolCallId);
      context.emittedToolIds.delete(toolCallId);
      break;
    }

    case "error": {
      const errorMsg = asString(state.error) ?? "Tool error";

      // If we haven't emitted start yet, emit it now
      if (!context.emittedToolIds.has(toolCallId)) {
        events.push({
          kind: "agent.tool_call.start",
          toolName,
          toolCallId,
        });

        if (SUBAGENT_TOOLS.has(toolName)) {
          context.subagentTracker.track(toolCallId);
        }
      }

      events.push({
        kind: "agent.tool_call.result",
        toolCallId,
        toolName,
        success: false,
        outputPreview: errorMsg.slice(0, 200),
      });

      // Complete subagent as failed
      const subagentComplete = context.subagentTracker.complete(toolCallId, false);
      if (subagentComplete) events.push(subagentComplete);

      context.activeTools.delete(toolCallId);
      context.emittedToolIds.delete(toolCallId);
      break;
    }
  }

  return { events };
};

// ---- Main mapper ----

export const mapOpenCodeToCanonical = (
  sessionId: string,
  eventType: string,
  props: Record<string, unknown>,
  context: OpenCodeCanonicalContext,
): CanonicalMappingResult => {
  switch (eventType) {
    case "message.part.delta": {
      const rawDelta = asString(props.delta);
      if (!rawDelta) return { events: [] };

      const partId = resolvePartId(props);
      const contentType =
        normalizeContentType(asString(props.partType)) ??
        context.partContentTypes.get(partId) ??
        normalizeContentType(asString(props.field)) ??
        "text";

      // ---- tool_use: accumulate buffer, try to parse when complete ----
      if (contentType === "tool_use") {
        const existing = context.toolUseBuffers.get(partId) ?? "";
        // Dedup snapshot: if rawDelta starts with existing, only append new part
        let newContent: string;
        if (rawDelta.startsWith(existing)) {
          newContent = rawDelta.slice(existing.length);
        } else {
          newContent = rawDelta;
        }
        const accumulated = existing + newContent;
        context.toolUseBuffers.set(partId, accumulated);

        // Try to parse the accumulated buffer as complete JSON
        const parsed = tryParseToolUse(accumulated);
        if (parsed) {
          // Clear buffer since we successfully parsed
          context.toolUseBuffers.delete(partId);

          const events: CanonicalEvent[] = [];
          const inputPreview = extractInputPreview(parsed.parsed, accumulated, parsed.toolName);

          if (!context.emittedToolIds.has(parsed.toolCallId)) {
            events.push({
              kind: "agent.tool_call.start",
              toolName: parsed.toolName,
              toolCallId: parsed.toolCallId,
              inputPreview,
            });
            context.emittedToolIds.add(parsed.toolCallId);
          }

          // Emit tool-specific events (file.read, bash.execute, etc.)
          const specificEvents = emitToolSpecificEvents(
            parsed.toolName,
            parsed.toolCallId,
            parsed.parsed,
            accumulated,
          );
          events.push(...specificEvents);

          // Track tool and subagent
          context.activeTools.set(parsed.toolCallId, { toolName: parsed.toolName });
          if (SUBAGENT_TOOLS.has(parsed.toolName)) {
            context.subagentTracker.track(parsed.toolCallId);
          }

          return { events };
        }

        // Not yet parseable — accumulating
        return { events: [] };
      }

      // ---- text / thinking: snapshot dedup ----
      const previous = context.partSnapshots.get(partId) ?? "";

      if (rawDelta.startsWith(previous)) {
        const incrementalDelta = rawDelta.slice(previous.length);
        context.partSnapshots.set(partId, rawDelta);

        if (incrementalDelta.length === 0) {
          return { events: [] };
        }

        const kind = contentType === "thinking" ? "agent.thinking" : "agent.text";
        return {
          events: [{ kind, content: incrementalDelta } as CanonicalEvent],
        };
      }

      // Text doesn't start with previous — full replacement
      context.partSnapshots.set(partId, rawDelta);

      if (contentType === "thinking") {
        return {
          events: [{ kind: "agent.thinking", content: rawDelta }],
        };
      }

      return {
        events: [{ kind: "agent.text.complete", fullText: rawDelta }],
      };
    }

    case "message.part.updated": {
      const part = asObject(props.part);
      if (!part) return { events: [] };

      const partId = resolvePartId(props);
      // Determine Part type: explicit part.type field, or fallback to partType prop
      const partType = asString(part.type) ?? asString(props.partType);
      const contentType = normalizeContentType(partType);
      if (contentType) {
        context.partContentTypes.set(partId, contentType);
      }

      switch (partType) {
        // ---- TextPart ----
        case "text": {
          const text = asString(part.text);
          if (text) {
            context.partSnapshots.set(partId, text);
            return {
              events: [{ kind: "agent.text.complete", fullText: text }],
            };
          }
          return { events: [] };
        }

        // ---- ReasoningPart ----
        case "reasoning": {
          const text = asString(part.text);
          if (text) {
            context.partSnapshots.set(partId, text);
          }
          // Reasoning snapshots don't emit text.complete — they're already
          // streamed via message.part.delta
          return { events: [] };
        }

        // ---- ToolPart ----
        case "tool": {
          return handleToolPart(partId, part, context);
        }

        // ---- AgentPart ----
        case "agent": {
          const name = asString(part.name) ?? "agent";
          const source = asString(part.source);
          const subagentId = partId;

          context.subagentTracker.track(subagentId);

          return {
            events: [{
              kind: "agent.subagent.spawn",
              subagentId,
              description: name,
              isBackground: false,
              subagentType: source,
            }],
          };
        }

        // ---- SubtaskPart ----
        case "subtask": {
          const description = asString(part.description) ?? asString(part.prompt) ?? "subtask";
          const agent = asString(part.agent);
          const subagentId = partId;

          context.subagentTracker.track(subagentId);

          return {
            events: [{
              kind: "agent.subagent.spawn",
              subagentId,
              description,
              isBackground: false,
              subagentType: agent,
            }],
          };
        }

        // ---- StepStartPart ----
        case "step-start": {
          return {
            events: [{ kind: "agent.step", description: "LLM step started" }],
          };
        }

        // ---- StepFinishPart ----
        case "step-finish": {
          const reason = asString(part.reason) ?? "completed";
          const tokens = asObject(part.tokens);
          const cost = typeof part.cost === "number" ? part.cost : undefined;
          let desc = `Step finished: ${reason}`;
          if (tokens) {
            const input = typeof tokens.input === "number" ? tokens.input : 0;
            const output = typeof tokens.output === "number" ? tokens.output : 0;
            desc += ` (${input + output} tokens)`;
          }
          if (cost != null) {
            desc += ` ($${cost.toFixed(4)})`;
          }
          return {
            events: [{ kind: "agent.step", description: desc }],
          };
        }

        // ---- FilePart ----
        case "file": {
          const filePath = asString(part.url) ?? asString(part.filename) ?? "unknown";
          return {
            events: [{
              kind: "agent.file.read",
              toolCallId: `file-${partId}`,
              filePath,
            }],
          };
        }

        // ---- PatchPart ----
        case "patch": {
          const files = Array.isArray(part.files) ? part.files : [];
          const events: CanonicalEvent[] = [];
          for (const file of files) {
            const filePath = typeof file === "string"
              ? file
              : typeof file === "object" && file !== null
                ? asString((file as Record<string, unknown>).path) ??
                  asString((file as Record<string, unknown>).name) ?? "unknown"
                : "unknown";
            events.push({
              kind: "agent.file.edit",
              toolCallId: `patch-${partId}`,
              filePath,
            });
          }
          return { events };
        }

        // ---- RetryPart ----
        case "retry": {
          const attempt = typeof part.attempt === "number" ? part.attempt : 0;
          const error = asObject(part.error);
          const errorMsg = error ? asString(error.message) ?? "API error" : "API error";
          return {
            events: [{
              kind: "agent.step",
              description: `Retry attempt ${attempt}: ${errorMsg}`,
            }],
          };
        }

        // ---- CompactionPart ----
        case "compaction": {
          return {
            events: [{
              kind: "agent.step",
              description: "Context compaction performed",
            }],
          };
        }

        // ---- Other Part types (snapshot, etc.) — no canonical mapping ----
        default: {
          // Fallback: if no explicit part.type, check legacy partType/contentType
          const rawPartType = asString(props.partType);
          const contentType = normalizeContentType(rawPartType) ?? "text";

          if (contentType === "text") {
            const text = asString(part.text);
            if (text) {
              context.partSnapshots.set(partId, text);
              return {
                events: [{ kind: "agent.text.complete", fullText: text }],
              };
            }
          }
          return { events: [] };
        }
      }
    }

    case "session.idle":
    case "session.status": {
      // Check if session.status indicates idle (OpenCode v2 format)
      if (eventType === "session.status") {
        const statusType = asString(props.type);
        if (statusType !== "idle") {
          return { events: [] };
        }
      }

      const events: CanonicalEvent[] = [];

      // Complete all pending tool calls
      for (const [toolCallId, info] of context.activeTools) {
        events.push({
          kind: "agent.tool_call.result",
          toolCallId,
          toolName: info.toolName,
          success: true,
        });
      }
      context.activeTools.clear();

      // Complete all active subagents
      events.push(...context.subagentTracker.completeAll(true));

      // Reset context for new turn
      context.partSnapshots.clear();
      context.partContentTypes.clear();
      context.toolUseBuffers.clear();
      context.emittedToolIds.clear();

      // Include native session metadata if available
      const idleMetadata: Record<string, unknown> = {};
      const nativeSessionId = asString(props.sessionID) ?? asString(props.sessionId);
      if (nativeSessionId) idleMetadata.nativeSessionId = nativeSessionId;

      events.push({
        kind: "session.idle",
        hasBackgroundAgents: false,
        isPlanningJob: false,
        ...(Object.keys(idleMetadata).length > 0 ? { metadata: idleMetadata } : {}),
      });

      return { events, terminal: true };
    }

    case "question.asked": {
      const text =
        asString(props.text) ?? asString(props.question) ?? "Input required";
      const options = Array.isArray(props.options)
        ? props.options.map((opt: unknown) => {
            if (typeof opt === "string") return opt;
            if (typeof opt === "object" && opt !== null) {
              const o = opt as Record<string, unknown>;
              const label = asString(o.label) ?? asString(o.value) ?? String(opt);
              const desc = asString(o.description);
              return desc ? `${label}::${desc}` : label;
            }
            return String(opt);
          })
        : undefined;

      return {
        events: [
          {
            kind: "agent.question",
            questionText: text,
            options,
          },
        ],
        requiresInput: true,
      };
    }

    case "permission.asked": {
      const toolName = asString(props.tool) ?? asString(props.toolName) ?? "unknown";
      const patterns = Array.isArray(props.patterns)
        ? props.patterns.filter((p): p is string => typeof p === "string").join(", ")
        : undefined;
      const description = patterns
        ? `${toolName}: ${patterns}`
        : asString(props.description);

      return {
        events: [{
          kind: "agent.permission.request",
          toolName,
          description,
        }],
        requiresInput: true,
      };
    }

    case "session.error": {
      const message =
        asString(props.message) ?? asString(props.error) ?? "OpenCode error";
      return {
        events: [
          {
            kind: "session.error",
            message,
            recoverable: false,
          },
        ],
      };
    }

    case "file.edited": {
      const file = asString(props.file);
      if (file) {
        return {
          events: [{
            kind: "agent.file.edit",
            toolCallId: `file-edit-${Date.now()}`,
            filePath: file,
          }],
        };
      }
      return { events: [] };
    }

    // Events we don't need to produce canonical events for
    case "server.heartbeat":
    case "server.connected":
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.diff":
    case "session.compacted":
    case "message.updated":
    case "message.removed":
    case "message.part.removed":
    case "question.replied":
    case "question.rejected":
    case "permission.replied":
    case "file.watcher.updated":
    case "command.executed":
    case "installation.updated":
    case "installation.update-available":
    case "lsp.updated":
    case "lsp.client.diagnostics":
    case "ide.installed":
      return { events: [] };

    default:
      return { events: [] };
  }
};
