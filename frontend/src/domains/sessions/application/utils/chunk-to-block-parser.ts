import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";
import { classifyShellCommandForDisplay } from "@/domains/shared/application/utils/shell-command-display";
import { stripDanglingBacktickBoundaryLines } from "./transcript-content-sanitizer";

/** Tool names hidden from the transcript (internal/noisy). */
const HIDDEN_TOOLS = new Set([
  "Bash",
  "ToolSearch",
  "EnterPlanMode", "ExitPlanMode",
  "TaskGet", "TaskList", "TaskStop", "TaskOutput",
]);

const isAnonymousMcpTool = (
  toolName: string,
  inputPreview: string | undefined,
): boolean => toolName === "mcp_tool" && !inputPreview?.trim();

const GENERIC_MCP_TOOL_NAMES = new Set(["mcp_tool", "MCP tool"]);

/** Tool names that represent agent/subagent invocations — rendered as subagent blocks. */
const AGENT_TOOLS = new Set(["Agent", "Task"]);

/**
 * Legacy control-token pattern — applied to reconstructed text (after joining all
 * consecutive deltas) so fragmented legacy control tokens like `[WAVE_START` + `]` are
 * matched correctly.
 *
 * Strips the tag AND everything after it on the same line, since those lines are legacy metadata.
 */
const LEGACY_CONTROL_TOKEN_LINE_PATTERN = /\[(?:STEP|WAVE_START|WAVE_END|AGENT_DONE|WAITING|RESPONSE_COMPLETE|DONE|WARN|ERROR|QUESTION|OPTIONS)\][^\n]*/g;
const LEGACY_INTERNAL_MARKER_LINE_PATTERN = /^\s*\[(?:todo_list)\]\s*$/gim;

/**
 * Try to parse a tool_use JSON from the chunk message.
 * The runner emits tool calls as raw JSON in the message field:
 *   {"name":"ToolName","id":"toolu_xxx"}
 *   {"name":"ToolName","id":"toolu_xxx","input":{...}}
 */
const parseToolFromMessage = (
  message: string,
): { name: string; id: string; input?: unknown } | null => {
  if (!message.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(message);
    if (parsed.name && parsed.id) return parsed;
  } catch {
    // not valid JSON
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const buildMcpToolName = (
  server: string | undefined,
  action: string | undefined,
): string | undefined => {
  if (!server || !action) return undefined;
  if (action.startsWith("mcp__")) return action;

  const normalizedServer = server.replace(/^mcp__/, "").trim();
  const normalizedAction = action.replace(/^__+/, "").trim();
  if (!normalizedServer || !normalizedAction) return undefined;

  return `mcp__${normalizedServer}__${normalizedAction}`;
};

const normalizeParsedToolName = (
  toolName: string,
  input: unknown,
): string => {
  if (toolName.startsWith("mcp__")) return toolName;
  if (!GENERIC_MCP_TOOL_NAMES.has(toolName)) return toolName;

  const inputRecord = asRecord(input);
  if (!inputRecord) return toolName;

  const explicitName =
    asString(inputRecord.name) ??
    asString(inputRecord.toolName) ??
    asString(inputRecord.tool_name);
  if (explicitName?.startsWith("mcp__")) return explicitName;

  return buildMcpToolName(
    asString(inputRecord.server) ??
      asString(inputRecord.serverName) ??
      asString(inputRecord.server_name),
    asString(inputRecord.tool) ??
      asString(inputRecord.toolName) ??
      asString(inputRecord.tool_name) ??
      asString(inputRecord.name),
  ) ?? toolName;
};

/** Keys whose value is shown directly without the key prefix. */
const VALUE_ONLY_KEYS = new Set(["title", "description", "name", "prompt"]);

/**
 * Build a human-readable input preview from a parsed tool call.
 * Mirrors the `extractInputPreview` logic from the canonical adapter
 * so sessions render the same way as planning.
 */
const buildInputPreview = (
  input: Record<string, unknown> | undefined,
  toolName: string,
): string | undefined => {
  if (!input) return undefined;

  if (GENERIC_MCP_TOOL_NAMES.has(toolName) || toolName.startsWith("mcp__")) {
    const args =
      asRecord(input.arguments) ??
      asRecord(input.params) ??
      asRecord(input.input);

    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string" && value.length > 0) {
          const preview = value.slice(0, 100);
          return VALUE_ONLY_KEYS.has(key) ? preview : `${key}: ${preview}`;
        }
      }
    }
  }

  // For Agent/Task, show subagent_type + description
  if (toolName === "Agent" || toolName === "Task") {
    const parts: string[] = [];
    if (typeof input.subagent_type === "string") parts.push(`subagent_type: ${input.subagent_type}`);
    if (typeof input.description === "string") parts.push(input.description.slice(0, 80));
    return parts.length > 0 ? parts.join(" | ") : undefined;
  }

  // Return first meaningful string param
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.length > 0) {
      const preview = v.slice(0, 100);
      return VALUE_ONLY_KEYS.has(k) ? preview : `${k}: ${preview}`;
    }
  }
  return undefined;
};

/**
 * Extract subagent type and description from an Agent/Task inputPreview.
 * The preview format is: "subagent_type: xxx | description text"
 */
const extractSubagentInfo = (
  inputPreview: string | undefined,
): { subagentType?: string; description: string } => {
  if (!inputPreview) return { description: "Agent" };

  const typeMatch = inputPreview.match(/subagent_type:\s*([a-zA-Z_:-]+)/);
  const subagentType = typeMatch?.[1];

  const pipeIdx = inputPreview.indexOf(" | ");
  const description =
    pipeIdx >= 0
      ? inputPreview.slice(pipeIdx + 3).trim()
      : subagentType
        ? ""
        : inputPreview;

  return { subagentType, description: description || subagentType || "Agent" };
};

/** Detect run_in_background from raw tool call JSON. */
const detectRunInBackground = (message: string): boolean => {
  return /run_in_background["\s]*[:=]\s*true/i.test(message);
};

const TASK_ID_PATTERN = /\b[A-Z][A-Z0-9]*-\d+\b/g;

const extractTaskIds = (text: string): Set<string> =>
  new Set(text.match(TASK_ID_PATTERN) ?? []);

const getSubagentTaskId = (
  block: StreamingBlock,
): string | undefined => {
  if (block.type !== "subagent") return undefined;
  return block.description.match(TASK_ID_PATTERN)?.[0];
};

const markBackgroundSubagentsDoneByTaskIds = (
  blocks: StreamingBlock[],
  taskIds: Set<string>,
): void => {
  if (taskIds.size === 0) return;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (
      block?.type !== "subagent" ||
      !block.isBackground ||
      block.status === "done"
    ) {
      continue;
    }

    const taskId = getSubagentTaskId(block);
    if (!taskId || !taskIds.has(taskId)) continue;

    blocks[index] = {
      ...block,
      status: "done",
    };
  }
};

const markBackgroundSubagentsDoneExceptRemaining = (
  blocks: StreamingBlock[],
  remainingTaskIds: Set<string>,
): void => {
  if (remainingTaskIds.size === 0) return;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (
      block?.type !== "subagent" ||
      !block.isBackground ||
      block.status === "done"
    ) {
      continue;
    }

    const taskId = getSubagentTaskId(block);
    if (!taskId || remainingTaskIds.has(taskId)) continue;

    blocks[index] = {
      ...block,
      status: "done",
    };
  }
};

const extractCompletedTaskIdsFromProgressText = (text: string): Set<string> => {
  const completedTaskIds = new Set<string>();
  const completedPattern =
    /\b([A-Z][A-Z0-9]*-\d+)\b[^.!?\n]{0,120}?\bcompleted successfully\b/gi;

  for (const match of text.matchAll(completedPattern)) {
    if (match[1]) completedTaskIds.add(match[1].toUpperCase());
  }

  return completedTaskIds;
};

const extractRemainingTaskIdsFromProgressText = (text: string): Set<string> => {
  const remainingTaskIds = new Set<string>();
  const remainingPatterns = [
    /\bwaiting for\s+([\s\S]{0,160}?)\s+to complete\b/gi,
    /\bwaiting for\s+([\s\S]{0,160}?)\./gi,
    /\bonly\s+([A-Z][A-Z0-9]*-\d+)\s+is left\b/gi,
  ];

  for (const pattern of remainingPatterns) {
    for (const match of text.matchAll(pattern)) {
      const ids = extractTaskIds(match[1] ?? "");
      for (const id of ids) remainingTaskIds.add(id.toUpperCase());
    }
  }

  return remainingTaskIds;
};

const applySubagentProgressText = (
  blocks: StreamingBlock[],
  text: string,
): void => {
  const completedTaskIds = extractCompletedTaskIdsFromProgressText(text);
  markBackgroundSubagentsDoneByTaskIds(blocks, completedTaskIds);

  const remainingTaskIds = extractRemainingTaskIdsFromProgressText(text);
  markBackgroundSubagentsDoneExceptRemaining(blocks, remainingTaskIds);
};

const extractCompletedTodoTaskIds = (
  parsedToolCall: Record<string, unknown>,
): Set<string> => {
  if (parsedToolCall.name !== "TodoWrite") return new Set();

  const input =
    typeof parsedToolCall.input === "object" && parsedToolCall.input !== null
      ? (parsedToolCall.input as Record<string, unknown>)
      : null;
  const todos = Array.isArray(input?.todos) ? input.todos : [];
  const completedTaskIds = new Set<string>();

  for (const todo of todos) {
    if (typeof todo !== "object" || todo === null) continue;
    const todoRecord = todo as Record<string, unknown>;
    if (todoRecord.status !== "completed") continue;

    const content = [
      typeof todoRecord.content === "string" ? todoRecord.content : "",
      typeof todoRecord.activeForm === "string" ? todoRecord.activeForm : "",
    ].join(" ");

    for (const taskId of extractTaskIds(content)) {
      completedTaskIds.add(taskId.toUpperCase());
    }
  }

  return completedTaskIds;
};

/**
 * Extract all valid top-level JSON objects from a concatenated string.
 * Uses bracket counting to find object boundaries in content like:
 *   {"name":"Agent","id":"toolu_xxx","input":{}}{"subagent_type":"..."}{"name":"Agent","id":"toolu_xxx","input":{"subagent_type":"..."}}
 * Fragments that don't form valid JSON are skipped.
 */
const extractJsonObjects = (content: string): Array<Record<string, unknown>> => {
  const results: Array<Record<string, unknown>> = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "{") {
      let depth = 0;
      let j = i;
      let inString = false;
      let escaped = false;
      while (j < content.length) {
        const ch = content[j];
        if (escaped) { escaped = false; j++; continue; }
        if (ch === "\\" && inString) { escaped = true; j++; continue; }
        if (ch === '"') { inString = !inString; j++; continue; }
        if (!inString) {
          if (ch === "{") depth++;
          else if (ch === "}") { depth--; if (depth === 0) { j++; break; } }
        }
        j++;
      }
      if (depth === 0) {
        const candidate = content.slice(i, j);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object") results.push(parsed);
        } catch { /* not valid JSON, skip */ }
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return results;
};

/**
 * Intermediate representation — groups consecutive chunks of the same type
 * before converting to StreamingBlock[]. This lets us reconstruct full text
 * from fragmented streaming deltas and strip legacy control tokens correctly.
 */
type MergedSegment =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; chunk: AgentLogChunk }
  | { type: "tool_use_merged"; content: string }
  | { type: "lifecycle"; block: StreamingBlock };

const normalizeSummaryDuplicateText = (value: string): string =>
  value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const isDuplicateSummaryTextSegment = (
  textSegment: string,
  summaryText: string,
  section: "Summary" | "Resumen",
): boolean => {
  const normalizedSegment = normalizeSummaryDuplicateText(textSegment);
  const normalizedSummary = normalizeSummaryDuplicateText(summaryText);
  const normalizedSummaryWithSection = normalizeSummaryDuplicateText(
    `${section} ${summaryText}`,
  );

  return [normalizedSummary, normalizedSummaryWithSection].some(
    (candidate) => candidate.length > 0 && normalizedSegment === candidate,
  );
};

/**
 * Parse AgentLogChunk[] into StreamingBlock[] for rich rendering.
 *
 * Two-pass approach:
 * 1. Merge consecutive deltas of the same type into complete segments
 * 2. Convert segments to StreamingBlock[], stripping legacy control tokens from full text
 *
 * This solves the fragmentation problem where legacy control tokens are split across deltas
 * are split across multiple streaming delta chunks.
 */
const SESSION_INTERRUPTION_EVENTS = new Set(["session.closed", "session.error"]);

export const parseChunksToStreamingBlocks = (
  chunks: AgentLogChunk[],
  isSessionLive = false,
): StreamingBlock[] => {
  // --- Pass 1: Merge consecutive deltas into segments ---
  const segments: MergedSegment[] = [];
  const toolCallMap = new Map<string, number>();
  const aliasedBashToolCalls = new Map<string, ReturnType<typeof classifyShellCommandForDisplay>>();
  let hasSeenSessionStart = false;
  let hasPendingSessionReconnect = false;

  for (const chunk of chunks) {
    if (chunk.phase === "session" && chunk.eventType === "session.created") {
      hasSeenSessionStart = true;
      hasPendingSessionReconnect = false;
      continue;
    }

    if (chunk.phase === "session" && chunk.eventType === "session.connected") {
      if (hasSeenSessionStart && hasPendingSessionReconnect) {
        segments.push({
          type: "lifecycle",
          block: { type: "session-reconnect", timestamp: chunk.timestamp },
        });
      }
      hasSeenSessionStart = true;
      hasPendingSessionReconnect = false;
      continue;
    }

    if (chunk.phase === "session" && SESSION_INTERRUPTION_EVENTS.has(chunk.eventType)) {
      if (hasSeenSessionStart) {
        hasPendingSessionReconnect = true;
      }
      continue;
    }

    // Include key lifecycle events from non-transcript phases
    if (chunk.phase === "skills" && chunk.eventType === "skill.validated") {
      const skillName = (chunk.payload?.skillName as string) ?? "";
      if (skillName) {
        segments.push({ type: "lifecycle", block: { type: "info", content: `Loading skill: \`${skillName}\`` } });
      }
      continue;
    }
    // prompt.sent is rendered as a user message via chunks-to-conversation-messages
    if (chunk.phase === "session" && chunk.eventType === "prompt.sent") {
      continue;
    }

    // Surface warn/error logs as alert blocks, but skip internal operational
    // phases (pr, push, completion, interaction) that produce routine non-user-facing logs.
    const INTERNAL_PHASES = new Set(["pr", "push", "completion", "interaction"]);
    if ((chunk.level === "warn" || chunk.level === "error") && !INTERNAL_PHASES.has(chunk.phase)) {
      const icon = chunk.level === "error" ? "❌" : "⚠️";
      let content = `${icon} **${chunk.message}**`;

      // Include relevant payload details if available
      const payload = chunk.payload;
      if (payload) {
        const detail =
          (typeof payload.errorMessage === "string" && payload.errorMessage) ||
          (typeof payload.output === "string" && payload.output);
        if (detail) {
          content += `\n\n\`\`\`\n${detail.slice(0, 500)}\n\`\`\``;
        }
      }

      segments.push({ type: "lifecycle", block: { type: "info", content } });
      continue;
    }

    // Handle subagent lifecycle events emitted by the runner
    if (chunk.phase === "transcript" && chunk.eventType === "subagent.spawn") {
      const payload = chunk.payload;
      const subagentId = payload?.subagentId as string | undefined;
      if (subagentId) {
        const newType = (payload?.subagentType as string) ?? undefined;
        const newDesc = chunk.message || newType || "Agent";
        const newBg = (payload?.isBackground as boolean) ?? false;

        if (!toolCallMap.has(subagentId)) {
          toolCallMap.set(subagentId, segments.length);
          segments.push({
            type: "lifecycle",
            block: {
              type: "subagent",
              subagentId,
              description: newDesc,
              isBackground: newBg,
              status: isSessionLive ? "running" : "done",
              subagentType: newType,
            },
          });
        } else {
          // Enrich existing block with better metadata from later events
          const idx = toolCallMap.get(subagentId)!;
          const seg = segments[idx];
          if (seg?.type === "lifecycle" && seg.block.type === "subagent") {
            const existing = seg.block;
            if (newType && !existing.subagentType) existing.subagentType = newType;
            if (newDesc !== "Agent" && existing.description === "Agent") existing.description = newDesc;
            if (newBg && !existing.isBackground) existing.isBackground = newBg;
          }
        }
      }
      continue;
    }

    if (chunk.phase === "transcript" && chunk.eventType === "subagent.complete") {
      const subagentId = chunk.payload?.subagentId as string | undefined;
      if (subagentId && toolCallMap.has(subagentId)) {
        const idx = toolCallMap.get(subagentId)!;
        const seg = segments[idx];
        if (seg?.type === "lifecycle" && seg.block.type === "subagent") {
          seg.block = { ...seg.block, status: "done" };
        }
      }
      continue;
    }

    if (chunk.phase === "transcript" && chunk.eventType === "agent.summary") {
      const text = (chunk.payload?.text as string | undefined) ?? chunk.message;
      const sectionRaw = chunk.payload?.section as string | undefined;
      const section: "Summary" | "Resumen" =
        sectionRaw === "Resumen" ? "Resumen" : "Summary";
      if (text) {
        const last = segments[segments.length - 1];
        if (
          last?.type === "text" &&
          isDuplicateSummaryTextSegment(last.content, text, section)
        ) {
          segments.pop();
        }

        segments.push({
          type: "lifecycle",
          block: { type: "summary", text, section },
        });
      }
      continue;
    }

    if (chunk.phase !== "transcript") continue;

    if (chunk.eventType === "agent.bash.execute") {
      const toolCallId = chunk.payload?.toolCallId as string | undefined;
      const command = chunk.payload?.command as string | undefined;
      const description = chunk.payload?.description as string | undefined;
      if (!toolCallId || !command) continue;

      const commandAlias = classifyShellCommandForDisplay(command);
      if (commandAlias) {
        aliasedBashToolCalls.set(toolCallId, commandAlias);

        if (!toolCallMap.has(toolCallId)) {
          toolCallMap.set(toolCallId, segments.length);
          segments.push({
            type: "lifecycle",
            block: {
              type: "tool_call",
              toolName: commandAlias.toolName,
              toolCallId,
              status: "success",
              inputPreview: commandAlias.inputPreview,
            },
          });
        }
        continue;
      }

      if (!toolCallMap.has(toolCallId)) {
        toolCallMap.set(toolCallId, segments.length);
        segments.push({
          type: "lifecycle",
          block: {
            type: "bash",
            toolCallId,
            command,
            description,
          },
        });
      }
      continue;
    }

    if (chunk.eventType === "agent.bash.output") {
      const toolCallId = chunk.payload?.toolCallId as string | undefined;
      const output = chunk.payload?.output as string | undefined;
      if (toolCallId && aliasedBashToolCalls.has(toolCallId)) continue;
      if (!toolCallId || !output || !toolCallMap.has(toolCallId)) continue;

      const idx = toolCallMap.get(toolCallId)!;
      const seg = segments[idx];
      if (seg?.type === "lifecycle" && seg.block.type === "bash") {
        seg.block = {
          ...seg.block,
          output: seg.block.output
            ? `${seg.block.output}${output}`
            : output,
        };
      }
      continue;
    }

    if (chunk.contentType === "tool_use") {
      const text = chunk.message;
      // If chunk has structured payload with toolName, keep legacy per-chunk handling
      if (chunk.payload?.toolName) {
        segments.push({ type: "tool_use", chunk });
      } else if (text) {
        // Merge consecutive raw tool_use deltas so fragmented JSON from
        // Agent/Task tool calls can be reconstructed with full input data
        const last = segments[segments.length - 1];
        if (last?.type === "tool_use_merged") {
          last.content += text;
        } else {
          segments.push({ type: "tool_use_merged", content: text });
        }
      }
      continue;
    }

    if (chunk.contentType === "thinking") {
      const text = chunk.message;
      if (!text) continue;
      const last = segments[segments.length - 1];
      if (last?.type === "thinking") {
        last.content += text;
      } else {
        segments.push({ type: "thinking", content: text });
      }
      continue;
    }

    // Default: text
    if (chunk.contentType === "text" || !chunk.contentType) {
      const text = chunk.message;
      if (!text) continue;
      const last = segments[segments.length - 1];
      if (last?.type === "text") {
        last.content += text;
      } else {
        segments.push({ type: "text", content: text });
      }
      continue;
    }
  }

  // --- Pass 2: Convert segments to StreamingBlock[] ---
  const blocks: StreamingBlock[] = [];

  for (const segment of segments) {
    if (segment.type === "lifecycle") {
      blocks.push(segment.block);
      continue;
    }

    if (segment.type === "thinking") {
      applySubagentProgressText(blocks, segment.content);
      blocks.push({ type: "thinking", content: segment.content });
      continue;
    }

    if (segment.type === "tool_use") {
      const chunk = segment.chunk;
      const payload = chunk.payload;
      let toolName = payload?.toolName as string | undefined;
      let toolCallId = (payload?.toolCallId as string) ?? undefined;
      let inputPreview = payload?.inputPreview as string | undefined;

      if (!toolName) {
        const parsed = parseToolFromMessage(chunk.message);
        if (parsed) {
          toolName = normalizeParsedToolName(parsed.name, parsed.input);
          toolCallId = parsed.id;
          inputPreview = buildInputPreview(
            parsed.input as Record<string, unknown> | undefined,
            toolName,
          );
        }
      }

      if (!toolName || !toolCallId) continue;
      if (isAnonymousMcpTool(toolName, inputPreview)) continue;
      const commandAlias = toolName === "Bash" && inputPreview
        ? classifyShellCommandForDisplay(inputPreview)
        : null;
      if (commandAlias) {
        toolName = commandAlias.toolName;
        inputPreview = commandAlias.inputPreview;
        aliasedBashToolCalls.set(toolCallId, commandAlias);
      }
      if (HIDDEN_TOOLS.has(toolName)) continue;

      // Convert Agent/Task tool calls to subagent blocks
      if (AGENT_TOOLS.has(toolName)) {
        if (!toolCallMap.has(toolCallId)) {
          toolCallMap.set(toolCallId, blocks.length);
          const info = extractSubagentInfo(inputPreview);
          const isBackground = (payload?.isBackground === true) ||
            detectRunInBackground(chunk.message);
          blocks.push({
            type: "subagent",
            subagentId: toolCallId,
            description: info.description,
            isBackground,
            status: isSessionLive ? "running" : "done",
            subagentType: info.subagentType,
          });
        }
        continue;
      }

      if (toolCallMap.has(toolCallId)) {
        const idx = toolCallMap.get(toolCallId)!;
        const existing = blocks[idx];
        if (existing?.type === "tool_call" && !existing.inputPreview && inputPreview) {
          blocks[idx] = { type: "tool_call", toolName, toolCallId, status: "success", inputPreview };
        }
        continue;
      }

      const idx = blocks.length;
      toolCallMap.set(toolCallId, idx);
      blocks.push({ type: "tool_call", toolName, toolCallId, status: "success", inputPreview });
      continue;
    }

    // --- merged tool_use segment: extract complete JSON objects ---
    if (segment.type === "tool_use_merged") {
      const jsonObjects = extractJsonObjects(segment.content);

      for (const parsed of jsonObjects) {
        markBackgroundSubagentsDoneByTaskIds(
          blocks,
          extractCompletedTodoTaskIds(parsed),
        );

        const parsedToolName = typeof parsed.name === "string" ? parsed.name : undefined;
        const toolCallId = typeof parsed.id === "string" ? parsed.id : undefined;
        if (!parsedToolName || !toolCallId) continue;
        let displayToolName = normalizeParsedToolName(
          parsedToolName,
          parsed.input,
        );

        let inputPreview = buildInputPreview(
          parsed.input as Record<string, unknown> | undefined,
          displayToolName,
        );
        if (isAnonymousMcpTool(displayToolName, inputPreview)) continue;

        const commandAlias = displayToolName === "Bash" && inputPreview
          ? classifyShellCommandForDisplay(inputPreview)
          : null;
        if (commandAlias) {
          displayToolName = commandAlias.toolName;
          inputPreview = commandAlias.inputPreview;
          aliasedBashToolCalls.set(toolCallId, commandAlias);
        }

        if (HIDDEN_TOOLS.has(displayToolName)) continue;

        if (AGENT_TOOLS.has(displayToolName)) {
          const existingIdx = toolCallMap.get(toolCallId);
          if (existingIdx !== undefined) {
            // Update existing subagent with richer data (e.g. full input with subagent_type)
            const existing = blocks[existingIdx];
            if (existing?.type === "subagent" && inputPreview) {
              const info = extractSubagentInfo(inputPreview);
              if (info.subagentType || (info.description !== "Agent" && info.description !== existing.description)) {
                blocks[existingIdx] = {
                  type: "subagent",
                  subagentId: toolCallId,
                  description: info.description || existing.description,
                  isBackground: existing.isBackground,
                  status: existing.status,
                  subagentType: info.subagentType || existing.subagentType,
                };
              }
            }
          } else {
            toolCallMap.set(toolCallId, blocks.length);
            const info = extractSubagentInfo(inputPreview);
            blocks.push({
              type: "subagent",
              subagentId: toolCallId,
              description: info.description,
              isBackground: false,
              status: "done",
              subagentType: info.subagentType,
            });
          }
          continue;
        }

        const existingIdx = toolCallMap.get(toolCallId);
        if (existingIdx !== undefined) {
          const existing = blocks[existingIdx];
          if (existing?.type === "tool_call" && !existing.inputPreview && inputPreview) {
            blocks[existingIdx] = { type: "tool_call", toolName: displayToolName, toolCallId, status: "success", inputPreview };
          }
          continue;
        }

        toolCallMap.set(toolCallId, blocks.length);
        blocks.push({ type: "tool_call", toolName: displayToolName, toolCallId, status: "success", inputPreview });
      }
      continue;
    }

    // --- text segment: full reconstructed text, strip legacy control tokens ---
    if (segment.type === "text") {
      let text = segment.content;

      // Strip legacy control-token lines from the fully reconstructed text
      text = text.replace(LEGACY_CONTROL_TOKEN_LINE_PATTERN, "");
      text = text.replace(LEGACY_INTERNAL_MARKER_LINE_PATTERN, "");
      text = stripDanglingBacktickBoundaryLines(text);

      // Collapse multiple blank lines into one
      text = text.replace(/\n{3,}/g, "\n\n").trim();
      if (!text) continue;

      applySubagentProgressText(blocks, text);

      // Check if the entire text is a tool_use JSON (legacy data)
      const parsed = parseToolFromMessage(text);
      if (parsed) {
        markBackgroundSubagentsDoneByTaskIds(
          blocks,
          extractCompletedTodoTaskIds(parsed),
        );

        let displayToolName = normalizeParsedToolName(parsed.name, parsed.input);
        const tcId = parsed.id;
        let preview = buildInputPreview(parsed.input as Record<string, unknown> | undefined, displayToolName);
        if (isAnonymousMcpTool(displayToolName, preview)) continue;
        const commandAlias = displayToolName === "Bash" && preview
          ? classifyShellCommandForDisplay(preview)
          : null;
        if (commandAlias) {
          displayToolName = commandAlias.toolName;
          preview = commandAlias.inputPreview;
          aliasedBashToolCalls.set(tcId, commandAlias);
        }
        if (HIDDEN_TOOLS.has(displayToolName)) continue;

        // Convert Agent/Task to subagent blocks
        if (AGENT_TOOLS.has(displayToolName)) {
          if (!toolCallMap.has(tcId)) {
            toolCallMap.set(tcId, blocks.length);
            const info = extractSubagentInfo(preview);
            const bgInput = parsed.input as Record<string, unknown> | undefined;
            const isBackground = bgInput?.run_in_background === true ||
              detectRunInBackground(text);
            blocks.push({
              type: "subagent",
              subagentId: tcId,
              description: info.description,
              isBackground,
              status: isSessionLive ? "running" : "done",
              subagentType: info.subagentType,
            });
          }
          continue;
        }

        if (toolCallMap.has(tcId)) {
          const existingIdx = toolCallMap.get(tcId)!;
          const existing = blocks[existingIdx];
          if (existing?.type === "tool_call" && !existing.inputPreview && preview) {
            blocks[existingIdx] = { type: "tool_call", toolName: displayToolName, toolCallId: tcId, status: "success", inputPreview: preview };
          }
          continue;
        }
        const idx = blocks.length;
        toolCallMap.set(tcId, idx);
        blocks.push({
          type: "tool_call",
          toolName: displayToolName,
          toolCallId: tcId,
          status: "success",
          inputPreview: preview,
        });
        continue;
      }

      blocks.push({ type: "text", content: text });
    }
  }

  return blocks.filter(Boolean);
};
