// ---------------------------------------------------------------------------
// SSE → Canonical event adapter
//
// Translates the intermediate SSE format (emitted by all runtime shims) into
// strongly typed canonical events. Runtime-agnostic: no planning logic, no
// interaction polling, no job status updates.
//
// Shims that emit canonical events directly (e.g. opencode-shim via
// onCanonicalEvent) have their events wrapped as SSE by the shim-server:
//   { type: "agent.text", properties: { kind: "agent.text", content: "..." } }
// These are detected and passed through without re-translation.
// ---------------------------------------------------------------------------

import type { CanonicalEvent } from "@almirant/stream-consumer";
import { parseWaveMarker } from "@almirant/canonical-events";
import type { EventAdapter, SseEvent } from "./adapter-types";

/** Known canonical event kind prefixes — used to detect passthrough events. */
const CANONICAL_KIND_PREFIXES = [
  "agent.",
  "session.",
  "heartbeat",
  "system.",
  "job.",
  "message.queued",
  "message.dequeued",
];

/** Check if a `kind` value is a canonical event kind (not an SSE event type). */
const isCanonicalKind = (kind: string): boolean =>
  CANONICAL_KIND_PREFIXES.some((prefix) => kind.startsWith(prefix));

type ContentType = "thinking" | "text" | "tool_use";

/** Tool names that map to file operation events. */
const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const FILE_WRITE_TOOLS = new Set(["Write"]);
const FILE_EDIT_TOOLS = new Set(["Edit"]);
const BASH_TOOLS = new Set(["Bash"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  agent: "Agent",
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  read: "Read",
  task: "Task",
  todowrite: "TodoWrite",
  write: "Write",
};

const normalizeToolName = (toolName: string): string =>
  TOOL_NAME_ALIASES[toolName.toLowerCase()] ?? toolName;

const mapPartTypeToContentType = (partType: unknown): ContentType | undefined => {
  if (partType === "reasoning" || partType === "thinking") return "thinking";
  if (partType === "text") return "text";
  if (partType === "tool" || partType === "tool_use") return "tool_use";
  return undefined;
};

type PartTracker = {
  contentType?: ContentType;
  emittedTextLength: number;
  lastInputPreview?: string;
  resultStatus?: string;
  specializedEmitted: boolean;
};

/**
 * Detects a structured summary block (`## Summary` / `## Resumen`) in the
 * assistant's final text and returns its body and section heading. Returns
 * null if no marker is found. Mirrors `extractStructuredSummary` in
 * orchestration/job-completion-guards.ts so the SSE adapter can surface the
 * same block to the transcript without relying on text parsing downstream.
 */
const SUMMARY_HEADING_REGEX = /^## (Summary|Resumen)\b\s*\n?/m;
const extractSummarySection = (
  text: string,
): { text: string; section: "Summary" | "Resumen" } | null => {
  const match = SUMMARY_HEADING_REGEX.exec(text);
  if (!match) return null;
  const body = text.slice(match.index + match[0].length).trim();
  if (!body) return null;
  return { text: body, section: match[1] as "Summary" | "Resumen" };
};

export const createSseCanonicalAdapter = (): EventAdapter => {
  let currentContentType: ContentType | undefined;
  let previousContentType: ContentType | undefined;
  let toolUseBuffer = "";
  // Accumulated text emitted via `agent.text` for the currently active text
  // part. Used to suppress a redundant `agent.text.complete` when the
  // `message.part.updated` snapshot only repeats what we already streamed as
  // deltas — the frontend would otherwise render the same text twice.
  let currentTextBuffer = "";
  let _hasActiveBackgroundAgents = false;
  let wasIdleWithBackgroundAgents = false;

  // Track last emitted tool call for result emission
  let lastEmittedToolCallId: string | undefined;
  let lastEmittedToolName: string | undefined;

  // Track active subagents for completion events.
  // Background subagents stay active after the Agent/Task tool call returns,
  // so they must only complete on an explicit subagent.complete event.
  const activeSubagents = new Map<string, { isBackground: boolean }>();

  // Track subagent spawns already emitted early (avoid double emission)
  const earlySpawnedToolCallIds = new Set<string>();
  let earlyDetectedToolCallId: string | undefined;

  // Track tool call IDs already emitted to avoid duplicates
  // (e.g. content_block_start emits start, content_block_stop enriches with full input)
  const emittedToolIds = new Set<string>();

  // OpenCode emits `message.part.updated` snapshots with the authoritative
  // part type, then streams `message.part.delta` by `partID`. Keep that
  // correlation locally so reasoning deltas do not degrade into plain text
  // and tool snapshots can become the same canonical events Claude emits.
  const partTrackers = new Map<string, PartTracker>();

  const getPartTracker = (partId: string | undefined): PartTracker | undefined => {
    if (!partId) return undefined;
    const existing = partTrackers.get(partId);
    if (existing) return existing;
    const created: PartTracker = {
      emittedTextLength: 0,
      specializedEmitted: false,
    };
    partTrackers.set(partId, created);
    return created;
  };

  // Latest detected `## Summary` / `## Resumen` block from any text.complete
  // snapshot during the session. Emitted as a single `agent.summary` event
  // before `session.idle` so the transcript can render a final summary card.
  let pendingSummary: { text: string; section: "Summary" | "Resumen" } | null =
    null;

  /**
   * Emit tool_call.result for the current pending tool call, and also
   * emit subagent.complete if the tool was a subagent (Agent/Task).
   * This ensures per-agent completion instead of batching at session.idle.
   */
  const emitToolCallResult = (success: boolean): CanonicalEvent[] => {
    const result: CanonicalEvent[] = [];
    if (lastEmittedToolCallId) {
      result.push({
        kind: "agent.tool_call.result",
        toolCallId: lastEmittedToolCallId,
        toolName: lastEmittedToolName ?? "unknown",
        success,
      });
      // Per-agent completion: if this tool was a subagent, complete it now
      const activeSubagent = activeSubagents.get(lastEmittedToolCallId);
      if (
        lastEmittedToolName &&
        SUBAGENT_TOOLS.has(lastEmittedToolName) &&
        activeSubagent &&
        !activeSubagent.isBackground
      ) {
        result.push({
          kind: "agent.subagent.complete",
          subagentId: lastEmittedToolCallId,
          success,
        });
        activeSubagents.delete(lastEmittedToolCallId);
      }
      lastEmittedToolCallId = undefined;
      lastEmittedToolName = undefined;
    }
    return result;
  };

  const resolveContentType = (
    props: Record<string, unknown>,
  ): ContentType | undefined => {
    if (typeof props.contentType === "string") {
      return mapPartTypeToContentType(props.contentType) ?? (props.contentType as ContentType);
    }
    if (typeof props.partType === "string") {
      const mapped = mapPartTypeToContentType(props.partType);
      if (mapped) {
        return mapped;
      }
    }
    const part = asRecord(props.part);
    const mapped = mapPartTypeToContentType(part?.type);
    if (mapped) return mapped;

    return undefined;
  };

  type StructuredQuestion = {
    text: string;
    options: string[];
  };

  const normalizeQuestionOption = (value: unknown): string | null => {
    if (typeof value === "string") return value;

    if (typeof value === "object" && value !== null) {
      const option = value as Record<string, unknown>;
      const label =
        (typeof option.label === "string" && option.label) ||
        (typeof option.value === "string" && option.value) ||
        "";
      if (!label) return null;
      const description =
        typeof option.description === "string" ? option.description : undefined;
      return description ? `${label}::${description}` : label;
    }

    return null;
  };

  const normalizeStructuredQuestions = (
    value: unknown,
  ): StructuredQuestion[] => {
    if (!Array.isArray(value)) return [];

    return value
      .map((question) => {
        if (typeof question !== "object" || question === null) return null;
        const questionObj = question as Record<string, unknown>;
        const text =
          (typeof questionObj.text === "string" && questionObj.text) ||
          (typeof questionObj.question === "string" && questionObj.question) ||
          "";
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

  const emitSpecializedToolEvents = (
    toolName: string,
    toolCallId: string,
    parsed: Record<string, unknown> | undefined,
    raw: string,
  ): CanonicalEvent[] => {
    const events: CanonicalEvent[] = [];

    if (FILE_READ_TOOLS.has(toolName)) {
      const filePath =
        extractParamAny(parsed, raw, ["file_path", "filePath", "path", "pattern"]);
      if (filePath) {
        const offset = extractParamAny(parsed, raw, ["offset"]);
        const limit = extractParamAny(parsed, raw, ["limit"]);
        events.push({
          kind: "agent.file.read",
          toolCallId,
          filePath,
          lineRange: offset ? `${offset}-${limit ?? ""}` : undefined,
        });
      }
    } else if (FILE_WRITE_TOOLS.has(toolName)) {
      const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
      if (filePath) {
        events.push({
          kind: "agent.file.write",
          toolCallId,
          filePath,
        });
      }
    } else if (FILE_EDIT_TOOLS.has(toolName)) {
      const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
      if (filePath) {
        events.push({
          kind: "agent.file.edit",
          toolCallId,
          filePath,
        });
      }
    } else if (BASH_TOOLS.has(toolName)) {
      const command = extractParamAny(parsed, raw, ["command"]);
      if (command) {
        // Wave-orchestration markers ride on a sentinel `echo`; emit the
        // structured `agent.wave.*` events instead of a shell command. Additive:
        // non-marker commands (parseWaveMarker returns []) fall through unchanged.
        const waveEvents = parseWaveMarker(command);
        if (waveEvents.length > 0) {
          events.push(...waveEvents);
        } else {
          events.push({
            kind: "agent.bash.execute",
            toolCallId,
            command,
            description: extractParamAny(parsed, raw, ["description", "title"]) ?? undefined,
          });
        }
      }
    } else if (SUBAGENT_TOOLS.has(toolName)) {
      const isBackground = detectBackgroundFromToolInput(parsed, raw);
      if (isBackground && !_hasActiveBackgroundAgents) {
        _hasActiveBackgroundAgents = true;
      }
      // Always emit spawn with full data (even if early-spawned with partial data).
      // The frontend deduplicates by subagentId and updates the existing block.
      const fullDesc =
        extractParamAny(parsed, raw, ["description"]) ??
        extractParamAny(parsed, raw, ["prompt"])?.slice(0, 200) ??
        toolName;
      const fullType =
        extractParamAny(parsed, raw, ["subagent_type", "subagentType", "agent"]) ??
        undefined;
      events.push({
        kind: "agent.subagent.spawn",
        subagentId: toolCallId,
        description: fullDesc,
        isBackground,
        subagentType: fullType,
      });
      activeSubagents.set(toolCallId, { isBackground });
    }

    return events;
  };

  const emitOpenCodeToolPartEvents = (
    part: Record<string, unknown>,
    tracker: PartTracker | undefined,
  ): CanonicalEvent[] => {
    const rawToolName = typeof part.tool === "string" ? part.tool : undefined;
    if (!rawToolName) return [];

    const toolName = normalizeToolName(rawToolName);
    const toolCallId =
      (typeof part.callID === "string" && part.callID) ||
      (typeof part.id === "string" && part.id) ||
      `tc-${Date.now()}`;
    const state = asRecord(part.state);
    const status = typeof state?.status === "string" ? state.status : undefined;
    const input = asRecord(state?.input) ?? {};
    const parsed: Record<string, unknown> = {
      id: toolCallId,
      name: toolName,
      input,
    };
    const raw =
      typeof state?.raw === "string" && state.raw.trim()
        ? state.raw
        : JSON.stringify(parsed);
    const events: CanonicalEvent[] = [];
    const inputPreview = extractInputPreview(parsed, raw, toolName);
    const alreadyStarted = emittedToolIds.has(toolCallId);

    if (!alreadyStarted) {
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview,
      });
      emittedToolIds.add(toolCallId);
      if (tracker) tracker.lastInputPreview = inputPreview;
    } else if (inputPreview && tracker?.lastInputPreview !== inputPreview) {
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview,
      });
      if (tracker) tracker.lastInputPreview = inputPreview;
    }

    lastEmittedToolCallId = toolCallId;
    lastEmittedToolName = toolName;

    if (status !== "pending" && tracker?.specializedEmitted !== true) {
      const specializedEvents = emitSpecializedToolEvents(
        toolName,
        toolCallId,
        parsed,
        raw,
      );
      if (specializedEvents.length > 0) {
        events.push(...specializedEvents);
        if (tracker) tracker.specializedEmitted = true;
      }
    }

    if (
      (status === "completed" || status === "error") &&
      tracker?.resultStatus !== status
    ) {
      events.push({
        kind: "agent.tool_call.result",
        toolCallId,
        toolName,
        success: status === "completed",
      });

      const activeSubagent = activeSubagents.get(toolCallId);
      if (
        SUBAGENT_TOOLS.has(toolName) &&
        activeSubagent &&
        !activeSubagent.isBackground
      ) {
        events.push({
          kind: "agent.subagent.complete",
          subagentId: toolCallId,
          success: status === "completed",
        });
        activeSubagents.delete(toolCallId);
      }

      if (tracker) tracker.resultStatus = status;
      if (lastEmittedToolCallId === toolCallId) {
        lastEmittedToolCallId = undefined;
        lastEmittedToolName = undefined;
      }
    }

    return events;
  };

  /**
   * Try to parse the accumulated tool_use JSON buffer and emit
   * tool-specific canonical events.
   */
  const emitToolCallEvents = (): CanonicalEvent[] => {
    const events: CanonicalEvent[] = [];
    const raw = toolUseBuffer.trim();
    if (!raw) return events;

    // Try to extract tool call info from the JSON buffer.
    // The buffer accumulates the JSON body of a tool_use content block.
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Partial JSON — try regex extraction
    }

    const rawToolName =
      (parsed && typeof parsed.name === "string" && parsed.name) ||
      extractField(raw, "name");
    const toolName = rawToolName ? normalizeToolName(rawToolName) : undefined;
    const toolCallId =
      (parsed && typeof parsed.id === "string" && parsed.id) ||
      extractField(raw, "id") ||
      `tc-${Date.now()}`;

    if (!toolName) return events;

    const isUpdate = emittedToolIds.has(toolCallId);
    const newPreview = extractInputPreview(parsed, raw, toolName);

    if (!isUpdate) {
      // First time seeing this tool call — emit start
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview: newPreview,
      });
      emittedToolIds.add(toolCallId);
    } else if (newPreview) {
      // Enriched data arrived (e.g. content_block_stop with full input) —
      // re-emit start so the frontend can update the inputPreview.
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview: newPreview,
      });
    }

    // Track for result emission
    lastEmittedToolCallId = toolCallId;
    lastEmittedToolName = toolName;

    events.push(...emitSpecializedToolEvents(toolName, toolCallId, parsed, raw));

    return events;
  };

  const processEvent = (sseEvent: SseEvent): CanonicalEvent[] => {
    const events: CanonicalEvent[] = [];

    let eventData: Record<string, unknown> = {};
    try {
      eventData = JSON.parse(sseEvent.data);
    } catch {
      // Non-JSON data — skip
      return events;
    }

    const eventType =
      typeof eventData.type === "string"
        ? eventData.type
        : sseEvent.event ?? "";

    const props =
      typeof eventData.properties === "object" && eventData.properties !== null
        ? (eventData.properties as Record<string, unknown>)
        : eventData;

    // ---- Canonical passthrough ----
    // Shims that produce canonical events directly (e.g. opencode-shim) have
    // their events wrapped by the shim-server as:
    //   { type: "<kind>", properties: { kind: "<kind>", ... } }
    // Detect these and return the properties as-is, only updating internal
    // state where needed (idle tracking, background agent detection).
    const passthroughKind = typeof props.kind === "string" ? props.kind : undefined;
    if (passthroughKind && isCanonicalKind(passthroughKind)) {
      // Track idle state for background agent detection
      if (passthroughKind === "session.idle") {
        // Flush pending tool buffer
        if (toolUseBuffer.trim()) {
          events.push(...emitToolCallEvents());
          toolUseBuffer = "";
          earlyDetectedToolCallId = undefined;
        }
        events.push(...emitToolCallResult(true));

        // Complete remaining foreground subagents. Background ones stay active
        // until their explicit completion event arrives.
        for (const [subagentId, meta] of activeSubagents.entries()) {
          if (meta.isBackground) continue;
          events.push({
            kind: "agent.subagent.complete",
            subagentId,
            success: true,
          });
          activeSubagents.delete(subagentId);
        }
        emittedToolIds.clear();

        currentContentType = undefined;
        previousContentType = undefined;
        currentTextBuffer = "";
        partTrackers.clear();

        if (_hasActiveBackgroundAgents) {
          wasIdleWithBackgroundAgents = true;
        }
      }

      // Track background agents from passthrough subagent events
      if (passthroughKind === "agent.subagent.spawn") {
        const subagentId = typeof props.subagentId === "string" ? props.subagentId : undefined;
        const isBg = typeof props.isBackground === "boolean" ? props.isBackground : false;
        if (subagentId) {
          activeSubagents.set(subagentId, { isBackground: isBg });
        }
        if (isBg) _hasActiveBackgroundAgents = true;
      }
      if (passthroughKind === "agent.subagent.complete") {
        const subagentId = typeof props.subagentId === "string" ? props.subagentId : undefined;
        if (subagentId) {
          activeSubagents.delete(subagentId);
        }
        const hasTrackedBackgroundSubagents = [...activeSubagents.values()].some(
          (subagent) => subagent.isBackground,
        );
        if (!hasTrackedBackgroundSubagents) {
          _hasActiveBackgroundAgents = false;
        }
      }

      // Return the canonical event as-is alongside any state-derived events
      events.push(props as CanonicalEvent);
      return events;
    }

    switch (eventType) {
      case "message.part.delta": {
        // Reset background agent flag on resume after idle
        if (wasIdleWithBackgroundAgents) {
          wasIdleWithBackgroundAgents = false;
          _hasActiveBackgroundAgents = false;
          toolUseBuffer = "";
          earlyDetectedToolCallId = undefined;
        }

        const partId = typeof props.partID === "string" ? props.partID : undefined;
        const tracker = partId ? partTrackers.get(partId) : undefined;
        const newContentType =
          resolveContentType(props) ?? tracker?.contentType ?? currentContentType;

        // Detect tool_use → other transition: flush tool buffer
        if (
          previousContentType === "tool_use" &&
          newContentType !== "tool_use"
        ) {
          events.push(...emitToolCallEvents());
          toolUseBuffer = "";
          earlyDetectedToolCallId = undefined;
        }

        // When the current text part ends (transition to a different content
        // type), reset the accumulated text buffer so the next text part
        // starts fresh and doesn't accidentally match an earlier snapshot.
        if (previousContentType === "text" && newContentType !== "text") {
          currentTextBuffer = "";
        }

        previousContentType = newContentType;
        currentContentType = newContentType;

        // If we just transitioned from tool_use, emit tool result + subagent completion
        if (lastEmittedToolCallId && currentContentType !== "tool_use") {
          events.push(...emitToolCallResult(true));
        }

        if (typeof props.delta === "string") {
          if (currentContentType === "tool_use") {
            // Detect boundary between consecutive tool_use blocks:
            // If buffer already has content and this delta starts a new JSON object,
            // check the ID to decide: different ID = flush previous; same ID = replace (enrichment).
            if (toolUseBuffer.trim() && typeof props.delta === "string" && props.delta.trimStart().startsWith("{")) {
              const newId = extractField(props.delta, "id");
              const existingId = extractField(toolUseBuffer, "id");
              if (newId && existingId) {
                if (newId !== existingId) {
                  // Different tool call — flush the previous one
                  events.push(...emitToolCallEvents());
                  events.push(...emitToolCallResult(true));
                  toolUseBuffer = "";
                  earlyDetectedToolCallId = undefined;
                } else {
                  // Same tool call ID — replace buffer with enriched version (content_block_stop data)
                  toolUseBuffer = "";
                }
              }
            }
            toolUseBuffer += props.delta;
            // Detect background agent in tool_use stream
            if (
              !_hasActiveBackgroundAgents &&
              /run_in_background["\s]*[:=]\s*true/i.test(toolUseBuffer)
            ) {
              _hasActiveBackgroundAgents = true;
            }

            // Early detection: emit tool_call.start and subagent.spawn as soon
            // as we detect name+id in the partial buffer, so the frontend can
            // show blocks immediately instead of waiting for tool completion.
            {
              const rawEarlyName = extractField(toolUseBuffer, "name");
              const earlyName = rawEarlyName ? normalizeToolName(rawEarlyName) : undefined;
              const earlyId = extractField(toolUseBuffer, "id");
              if (earlyName && earlyId) {
                // Emit tool_call.start early for ALL tools
                if (!emittedToolIds.has(earlyId)) {
                  events.push({
                    kind: "agent.tool_call.start",
                    toolName: earlyName,
                    toolCallId: earlyId,
                    inputPreview: extractInputPreview(undefined, toolUseBuffer, earlyName),
                  });
                  emittedToolIds.add(earlyId);
                }
                // Emit subagent.spawn for Agent/Task tools — early and on enrichment
                if (SUBAGENT_TOOLS.has(earlyName)) {
                  const earlyDesc =
                    extractParam(undefined, toolUseBuffer, "description") ??
                    extractParam(undefined, toolUseBuffer, "prompt")?.slice(0, 200) ??
                    earlyName;
                  const earlyBg = detectBackground(toolUseBuffer);
                  const earlyType = extractParam(undefined, toolUseBuffer, "subagent_type") ?? undefined;

                  if (!earlySpawnedToolCallIds.has(earlyId)) {
                    // Only emit early spawn if we have meaningful data (description or type).
                    // The first tool_use delta often only has {name, id} — no input params yet.
                    // Emitting with toolName ("Agent") as description causes a confusing flash.
                    // Wait for the enriched delta (content_block_stop) with full input.
                    const hasMeaningfulData = (earlyDesc !== earlyName) || !!earlyType;
                    // content_block_stop deltas always carry an "input" key (the
                    // shim re-emits the full tool JSON). If it arrived without
                    // meaningful data (OOM/stream cut truncated the input), this
                    // is the last reliable signal for the tool call — emit a
                    // minimal fallback spawn instead of omitting it entirely.
                    const isTerminalSnapshot = /"input"\s*:/.test(toolUseBuffer);
                    if (hasMeaningfulData || isTerminalSnapshot) {
                      earlySpawnedToolCallIds.add(earlyId);
                      earlyDetectedToolCallId = earlyId;
                      events.push({
                        kind: "agent.subagent.spawn",
                        subagentId: earlyId,
                        description: earlyDesc,
                        isBackground: earlyBg,
                        subagentType: earlyType,
                      });
                      activeSubagents.set(earlyId, { isBackground: earlyBg });
                    }
                  } else if (earlyType || (earlyDesc !== earlyName && earlyDesc !== "Agent")) {
                    // Re-emit with enriched data (content_block_stop arrived with full input).
                    // The frontend deduplicates by subagentId and updates description/type.
                    events.push({
                      kind: "agent.subagent.spawn",
                      subagentId: earlyId,
                      description: earlyDesc,
                      isBackground: earlyBg,
                      subagentType: earlyType,
                    });
                  }
                }
              }
            }
          } else if (currentContentType === "thinking") {
            if (tracker) {
              tracker.emittedTextLength += props.delta.length;
            }
            events.push({
              kind: "agent.thinking",
              content: props.delta,
            });
          } else {
            // Default to text
            currentTextBuffer += props.delta;
            if (tracker) {
              tracker.emittedTextLength += props.delta.length;
            }
            events.push({
              kind: "agent.text",
              content: props.delta,
            });
          }
        }
        break;
      }

      case "message.part.updated": {
        const part =
          typeof props.part === "object" && props.part !== null
            ? (props.part as Record<string, unknown>)
            : null;
        const partId = typeof part?.id === "string" ? part.id : undefined;
        const tracker = getPartTracker(partId);
        const newContentType =
          resolveContentType(props) ?? tracker?.contentType ?? currentContentType;
        currentContentType = newContentType;
        if (tracker && newContentType) {
          tracker.contentType = newContentType;
        }

        if (part && currentContentType === "tool_use") {
          events.push(...emitOpenCodeToolPartEvents(part, tracker));
          break;
        }

        if (
          part &&
          typeof part.text === "string" &&
          currentContentType === "thinking"
        ) {
          const emittedLength = tracker?.emittedTextLength ?? 0;
          const nextChunk = part.text.slice(emittedLength);
          if (nextChunk) {
            events.push({
              kind: "agent.thinking",
              content: nextChunk,
            });
          }
          if (tracker) {
            tracker.emittedTextLength = Math.max(
              tracker.emittedTextLength,
              part.text.length,
            );
          }
        } else if (part && typeof part.text === "string" && currentContentType === "text") {
          // Skip the snapshot if it only repeats text we already streamed as
          // `agent.text` deltas — the frontend would otherwise render the
          // same content twice (once from the deltas, once from .complete).
          const repeatsTrackedText =
            tracker !== undefined && tracker.emittedTextLength >= part.text.length;
          if (!repeatsTrackedText && part.text !== currentTextBuffer) {
            events.push({
              kind: "agent.text.complete",
              fullText: part.text,
            });
          }
          // Treat the snapshot as the authoritative state for the current
          // text part so subsequent deltas/snapshots compare against it.
          currentTextBuffer = part.text;
          if (tracker) {
            tracker.emittedTextLength = Math.max(
              tracker.emittedTextLength,
              part.text.length,
            );
          }
          const detected = extractSummarySection(part.text);
          if (detected) pendingSummary = detected;
        }
        break;
      }

      case "session.idle": {
        // Flush pending tool buffer
        if (toolUseBuffer.trim()) {
          events.push(...emitToolCallEvents());
          toolUseBuffer = "";
          earlyDetectedToolCallId = undefined;
        }

        // Snapshot the accumulated assistant text BEFORE resetting buffers
        // so the post-tool-flush summary fallback can scan it below.
        const accumulatedAssistantText = currentTextBuffer;

        currentContentType = undefined;
        previousContentType = undefined;
        currentTextBuffer = "";
        partTrackers.clear();

        if (_hasActiveBackgroundAgents) {
          wasIdleWithBackgroundAgents = true;
        }

        // Complete any pending tool call + associated subagent
        events.push(...emitToolCallResult(true));

        // Safety net: complete any remaining foreground subagents not yet
        // completed. Background subagents stay active until they emit an
        // explicit completion event.
        for (const [subagentId, meta] of activeSubagents.entries()) {
          if (meta.isBackground) continue;
          events.push({
            kind: "agent.subagent.complete",
            subagentId,
            success: true,
          });
          activeSubagents.delete(subagentId);
        }
        emittedToolIds.clear();

        // Some shims (notably the Claude Code path) only emit `agent.text`
        // deltas without ever sending `message.part.updated` snapshots, so
        // `pendingSummary` would still be null here even when the assistant
        // wrote a `## Summary` block. Fall back to scanning the accumulated
        // delta buffer (snapshotted above before reset) so the transcript
        // can render the final summary card.
        if (!pendingSummary && accumulatedAssistantText) {
          const fallback = extractSummarySection(accumulatedAssistantText);
          if (fallback) pendingSummary = fallback;
        }

        if (pendingSummary) {
          events.push({
            kind: "agent.summary",
            text: pendingSummary.text,
            section: pendingSummary.section,
          });
          pendingSummary = null;
        }

        events.push({
          kind: "session.idle",
          hasBackgroundAgents: _hasActiveBackgroundAgents,
          isPlanningJob: false, // Caller overrides this
        });
        break;
      }

      case "question.asked": {
        const questionText =
          typeof props.text === "string"
            ? props.text
            : typeof props.question === "string"
              ? props.question
              : sseEvent.data;

        // Preserve option structure — options may be strings or objects with
        // { value, label, description }. Convert objects to "label::description" format
        // for the frontend's existing option parser.
        const options = Array.isArray(props.options)
          ? props.options.map((opt: unknown) => {
              const normalized = normalizeQuestionOption(opt);
              return normalized ?? String(opt);
            })
          : [];
        const questions = normalizeStructuredQuestions(props.questions);

        events.push({
          kind: "agent.question",
          questionText,
          options: options.length > 0 ? options : undefined,
          ...(questions.length > 0 ? { questions } : {}),
          questionType:
            options.length > 0 ? "single_choice" : "free_text",
        });
        break;
      }

      case "permission.asked": {
        const toolName =
          typeof props.tool === "string"
            ? props.tool
            : typeof props.toolName === "string"
              ? props.toolName
              : "unknown";
        events.push({
          kind: "agent.permission.request",
          toolName,
          description:
            typeof props.description === "string"
              ? props.description
              : undefined,
        });
        break;
      }

      case "session.error": {
        const errObj =
          typeof props.error === "object" && props.error !== null
            ? (props.error as Record<string, unknown>)
            : undefined;
        const errData =
          typeof errObj?.data === "object" && errObj.data !== null
            ? (errObj.data as Record<string, unknown>)
            : undefined;
        const errMsg =
          typeof errData?.message === "string"
            ? errData.message
            : typeof errObj?.message === "string"
              ? errObj.message
              : typeof props.message === "string"
                ? props.message
                : sseEvent.data;

        const isRecoverable =
          /sqlite|disk is full|database.*full/i.test(errMsg);

        // Emit failed result for any pending tool call + subagent
        events.push(...emitToolCallResult(false));

        events.push({
          kind: "session.error",
          message: errMsg,
          recoverable: isRecoverable,
        });
        break;
      }

      case "session.closed": {
        events.push({
          kind: "session.closed",
          reason: typeof props.reason === "string" ? props.reason : undefined,
        });
        break;
      }

      case "message.queued": {
        events.push({
          kind: "message.queued",
          messageId: typeof props.messageId === "string" ? props.messageId : "",
          position: typeof props.position === "number" ? props.position : 0,
          queueDepth: typeof props.queueDepth === "number" ? props.queueDepth : 0,
        });
        break;
      }

      case "message.dequeued": {
        events.push({
          kind: "message.dequeued",
          messageId: typeof props.messageId === "string" ? props.messageId : "",
          remainingInQueue: typeof props.remainingInQueue === "number" ? props.remainingInQueue : 0,
        });
        break;
      }

      case "server.connected": {
        events.push({ kind: "session.connected" });
        break;
      }

      // Known informational events — ignore
      case "server.heartbeat":
      case "session.updated":
      case "session.diff":
      case "step-start":
      case "step-finish":
        break;

      case "session.status": {
        // session.status with status="error" carries an error message from
        // the runtime (e.g. Codex SDK throws). Surface it instead of ignoring.
        if (
          typeof props.status === "string" &&
          props.status === "error" &&
          typeof props.message === "string"
        ) {
          events.push(...emitToolCallResult(false));
          events.push({
            kind: "session.error",
            message: props.message,
            recoverable: false,
          });
        }
        break;
      }

      case "message.completed":
      case "message.updated": {
        // Flush pending tool buffer on message completion
        if (toolUseBuffer.trim()) {
          events.push(...emitToolCallEvents());
          toolUseBuffer = "";
          earlyDetectedToolCallId = undefined;
        }
        currentContentType = undefined;
        currentTextBuffer = "";
        break;
      }

      default: {
        // Check for error events in unknown types
        if (
          eventType.includes("error") ||
          typeof eventData.error === "string"
        ) {
          const errorMsg =
            typeof eventData.error === "string"
              ? eventData.error
              : typeof eventData.message === "string"
                ? eventData.message
                : sseEvent.data;
          events.push({
            kind: "session.error",
            message: errorMsg,
            recoverable: false,
          });
        }
        break;
      }
    }

    return events;
  };

  const flush = (): CanonicalEvent[] => {
    const events: CanonicalEvent[] = [];
    if (toolUseBuffer.trim()) {
      events.push(...emitToolCallEvents());
      toolUseBuffer = "";
    }
    // Complete any pending tool call + associated subagent
    events.push(...emitToolCallResult(true));
    return events;
  };

  return {
    processEvent,
    flush,
    hasActiveBackgroundAgents: () => _hasActiveBackgroundAgents,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

/** Extract a JSON field value by key from raw text using regex. */
const extractField = (raw: string, key: string): string | undefined => {
  const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i");
  const match = raw.match(regex);
  return match?.[1];
};

/** Extract a parameter from parsed JSON or raw text. */
const extractParam = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  key: string,
): string | undefined => {
  if (parsed) {
    // Check input.key or top-level key
    const input =
      typeof parsed.input === "object" && parsed.input !== null
        ? (parsed.input as Record<string, unknown>)
        : parsed;
    const val = input[key];
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
  }
  return extractField(raw, key);
};

const extractParamAny = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = extractParam(parsed, raw, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Detect if the tool call is for a background agent. */
const detectBackground = (raw: string): boolean => {
  return /run_in_background["\s]*[:=]\s*true/i.test(raw);
};

const detectBackgroundFromToolInput = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
): boolean => {
  if (extractParam(parsed, raw, "run_in_background") === "true") {
    return true;
  }
  return detectBackground(raw);
};

/** Keys whose value should be shown directly (without "key:" prefix) as the preview. */
const PREVIEW_VALUE_ONLY_KEYS = new Set(["title", "description", "name", "prompt"]);

/** Build a short input preview string for tool_call.start events. */
const extractInputPreview = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  toolName?: string,
): string | undefined => {
  if (!parsed) {
    // For Agent/Task tools, return a longer slice so the frontend can
    // extract subagent_type via regex for instant pre-creation.
    if (toolName && SUBAGENT_TOOLS.has(toolName)) {
      return raw.slice(0, 300);
    }
    return raw.slice(0, 100);
  }
  const input =
    typeof parsed.input === "object" && parsed.input !== null
      ? (parsed.input as Record<string, unknown>)
      : null;
  if (input) {
    // For Agent/Task tools, include subagent_type + description so the
    // frontend can pre-create the block immediately on tool_call.start.
    if (toolName && SUBAGENT_TOOLS.has(toolName)) {
      const parts: string[] = [];
      const st = input.subagent_type;
      if (typeof st === "string") parts.push(`subagent_type: ${st}`);
      const desc = input.description;
      if (typeof desc === "string") parts.push(`description: ${desc.slice(0, 80)}`);
      if (parts.length > 0) return parts.join(" | ");
    }
    // Return first meaningful param
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string" && v.length > 0) {
        const preview = v.slice(0, 80);
        return PREVIEW_VALUE_ONLY_KEYS.has(k) ? preview : `${k}: ${preview}`;
      }
    }
  }
  return undefined;
};
