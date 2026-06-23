import type { CanonicalEvent as ShimCanonicalEvent } from "@almirant/shim-server";

// ---------------------------------------------------------------------------
// Codex SDK → Canonical Event Mapper
//
// Converts raw Codex SDK events (item.updated, item.completed,
// turn.completed, etc.) directly into CanonicalEvent objects.
// Uses snapshot-based deduplication identical to the SSE mapper.
// ---------------------------------------------------------------------------

export type CodexBashOutputEvent = {
  kind: "agent.bash.output";
  toolCallId: string;
  output: string;
  exitCode?: number;
  metadata?: Record<string, unknown>;
};

export type CodexCanonicalEvent = ShimCanonicalEvent | CodexBashOutputEvent;

export type CodexCanonicalMappingResult = {
  events: CodexCanonicalEvent[];
  terminal?: boolean;
  requiresInput?: boolean;
};

export type CodexCanonicalMappingContext = {
  messageSnapshots: Map<string, string>;
  emittedToolCallIds: Set<string>;
};

type CanonicalEvent = CodexCanonicalEvent;

// ---- Helpers ----

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asJsonPreview = (value: unknown, maxLen = 200): string | undefined => {
  if (typeof value === "string") return value.slice(0, maxLen);
  if (value == null) return undefined;
  try {
    return JSON.stringify(value).slice(0, maxLen);
  } catch {
    return undefined;
  }
};

const normalizeType = (event: Record<string, unknown>): string => {
  return (
    asString(event.type) ??
    asString(event.event) ??
    asString(event.method) ??
    ""
  );
};

const getErrorMessage = (event: Record<string, unknown>): string => {
  const nestedError = asRecord(event.error);
  return (
    asString(event.message) ??
    asString(event.error) ??
    asString(nestedError?.message) ??
    "Codex runtime error"
  );
};

const getCommandDisplayText = (item: Record<string, unknown>): string | undefined => {
  const command = asString(item.command);
  const output = asString(item.aggregated_output);
  const text = asString(item.text);
  if (command && output) return `$ ${command}\n${output}`;
  if (command) return `$ ${command}`;
  if (output) return output;
  return text;
};

const getCommandOutput = (item: Record<string, unknown>): string | undefined => {
  const aggregated = asString(item.aggregated_output);
  if (aggregated) return aggregated;

  const displayText = getCommandDisplayText(item);
  if (!displayText) return undefined;

  const firstNewline = displayText.indexOf("\n");
  if (firstNewline === -1) return undefined;

  const output = displayText.slice(firstNewline + 1);
  return output.length > 0 ? output : undefined;
};

const sanitizeMcpPart = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const resolveMcpToolName = (item: Record<string, unknown>): string => {
  const directName = asString(item.name);
  if (directName?.startsWith("mcp__")) return directName;

  const rawToolName =
    asString(item.tool) ??
    asString(item.tool_name) ??
    directName ??
    asString(item.toolName);
  const rawServerName =
    asString(item.server) ??
    asString(item.server_name) ??
    asString(item.serverName);

  if (rawToolName?.startsWith("mcp__")) return rawToolName;

  const toolName = rawToolName ? sanitizeMcpPart(rawToolName) : "";
  const serverName = rawServerName ? sanitizeMcpPart(rawServerName) : "";

  if (serverName && toolName) return `mcp__${serverName}__${toolName}`;
  if (rawToolName) return rawToolName;
  return "mcp_tool";
};

const extractCommandFromText = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const match = text.match(/^\$\s*(.+)$/m);
  return match?.[1]?.trim() || undefined;
};

const getCommand = (item: Record<string, unknown>): string | undefined => {
  return (
    asString(item.command) ??
    asString(item.call) ??
    extractCommandFromText(getCommandDisplayText(item))
  );
};

const PATH_KEYS = new Set([
  "path",
  "file",
  "filename",
  "filePath",
  "file_path",
  "filepath",
  "targetPath",
  "target_path",
]);

const OPERATION_KEYS = new Set([
  "operation",
  "action",
  "changeType",
  "change_type",
]);

const findNestedStringByKeys = (
  value: unknown,
  keys: Set<string>,
  depth = 0,
): string | undefined => {
  if (depth > 4 || value == null) return undefined;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedStringByKeys(entry, keys, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  for (const [key, nestedValue] of Object.entries(record)) {
    if (keys.has(key)) {
      const direct = asString(nestedValue);
      if (direct) return direct;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findNestedStringByKeys(nestedValue, keys, depth + 1);
    if (nested) return nested;
  }

  return undefined;
};

const extractPathFromText = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const match = text.match(
    /((?:\/|\.{1,2}\/)[^\s"'`]+|(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)/,
  );
  return match?.[1];
};

const getFilePath = (item: Record<string, unknown>): string | undefined => {
  return (
    asString(item.path) ??
    asString(item.file) ??
    asString(item.filename) ??
    findNestedStringByKeys(item, PATH_KEYS) ??
    extractPathFromText(asString(item.text))
  );
};

const getFileOperation = (item: Record<string, unknown>): string => {
  const firstChange = Array.isArray(item.changes)
    ? asRecord(item.changes[0])
    : null;
  return (
    asString(item.operation) ??
    asString(item.action) ??
    asString(firstChange?.kind) ??
    findNestedStringByKeys(item, OPERATION_KEYS) ??
    "update"
  );
};

const shouldEmitToolStart = (
  context: CodexCanonicalMappingContext,
  toolCallId: string,
): boolean => {
  if (context.emittedToolCallIds.has(toolCallId)) {
    return false;
  }
  context.emittedToolCallIds.add(toolCallId);
  return true;
};

// ---- Text (agent_message) ----

const mapAgentMessageUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__default";
  const text = asString(item.text);
  if (!text) return [];

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [{ kind: "agent.text", content: delta }];
    }
    return [];
  }

  // Text changed non-incrementally — emit a full replacement.
  return [{ kind: "agent.text.complete", fullText: text }];
};

const mapAgentMessageCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__default";
  const text = asString(item.text);
  if (!text) return [];

  context.messageSnapshots.set(itemId, text);
  return [{ kind: "agent.text.complete", fullText: text }];
};

// ---- Thinking (reasoning) ----

const mapReasoningUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__reasoning";
  const text = asString(item.text);
  if (!text) return [];

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [{ kind: "agent.thinking", content: delta }];
    }
    return [];
  }

  // Non-incremental change — emit full text as a thinking event.
  return [{ kind: "agent.thinking", content: text }];
};

const mapReasoningCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__reasoning";
  const text = asString(item.text);
  if (!text) return [];

  context.messageSnapshots.set(itemId, text);
  return [{ kind: "agent.thinking", content: text }];
};

// ---- Command execution (shown as text) ----

const mapCommandExecutionUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__command";
  const text = getCommandDisplayText(item);
  if (!text) return [];

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      const shouldEmitOutputDelta = previous.includes("\n") || delta.startsWith("\n");
      const deltaOutput = shouldEmitOutputDelta
        ? (delta.startsWith("\n") ? delta.slice(1) : delta)
        : undefined;
      return [
        ...(deltaOutput
          ? [{
              kind: "agent.bash.output" as const,
              toolCallId: itemId,
              output: deltaOutput,
            }]
          : []),
        {
          kind: "agent.text",
          content: delta,
          metadata: {
            source: "command_execution",
            toolCallId: itemId,
          },
        },
      ];
    }
    return [];
  }

  return [
    ...(getCommandOutput(item)
      ? [{
          kind: "agent.bash.output" as const,
          toolCallId: itemId,
          output: getCommandOutput(item)!,
        }]
      : []),
    {
      kind: "agent.text.complete",
      fullText: text,
      metadata: {
        source: "command_execution",
        toolCallId: itemId,
      },
    },
  ];
};

const mapCommandExecutionCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const itemId = asString(item.id) ?? "__command";
  const text = getCommandDisplayText(item);
  if (!text) return [];

  context.messageSnapshots.set(itemId, text);
  return [
    ...(getCommandOutput(item)
      ? [{
          kind: "agent.bash.output" as const,
          toolCallId: itemId,
          output: getCommandOutput(item)!,
        }]
      : []),
    {
      kind: "agent.text.complete",
      fullText: text,
      metadata: {
        source: "command_execution",
        toolCallId: itemId,
      },
    },
  ];
};

// ---- File change ----

const mapFileChangeUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const filePath = getFilePath(item);
  if (!filePath) return [];

  const operation = getFileOperation(item);
  const toolCallId = asString(item.id) ?? `fc-${Date.now()}`;

  const events: CanonicalEvent[] = [];

  if (shouldEmitToolStart(context, toolCallId)) {
    events.push({
      kind: "agent.tool_call.start",
      toolName: "FileChange",
      toolCallId,
      inputPreview: `${operation}: ${filePath}`,
    });
  }

  if (operation === "add" || operation === "create") {
    events.push({ kind: "agent.file.write", toolCallId, filePath });
  } else if (operation === "delete" || operation === "remove") {
    events.push({ kind: "agent.file.edit", toolCallId, filePath });
  } else {
    events.push({ kind: "agent.file.edit", toolCallId, filePath });
  }

  return events;
};

const mapFileChangeCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolCallId = asString(item.id) ?? `fc-${Date.now()}`;
  const filePath = getFilePath(item) ?? "unknown";

  const events = mapFileChangeUpdated(item, context);
  events.push({
    kind: "agent.tool_call.result",
    toolCallId,
    toolName: "FileChange",
    success: true,
    outputPreview: `File ${getFileOperation(item)}: ${filePath}`,
  });
  return events;
};

// ---- MCP tool call ----

const getMcpArguments = (item: Record<string, unknown>): unknown =>
  item.arguments ?? item.input;

const getMcpResultPreview = (item: Record<string, unknown>): string | undefined => {
  const result = asRecord(item.result);
  if (!result) return undefined;

  const content = Array.isArray(result.content) ? result.content : [];
  const textContent = content
    .map((part) => {
      const block = asRecord(part);
      if (!block) return null;
      return asString(block.text) ?? asString(block.content);
    })
    .filter((value): value is string => !!value)
    .join("\n")
    .trim();

  if (textContent) return textContent.slice(0, 300);
  return asJsonPreview(result.structured_content ?? result, 300);
};

const mapMcpToolCallUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolName = resolveMcpToolName(item);
  const toolCallId = asString(item.id) ?? `mcp-${Date.now()}`;

  if (!shouldEmitToolStart(context, toolCallId)) {
    return [];
  }

  return [
    {
      kind: "agent.tool_call.start",
      toolName,
      toolCallId,
      inputPreview: asJsonPreview(getMcpArguments(item), 300),
    },
  ];
};

const mapMcpToolCallCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolName = resolveMcpToolName(item);
  const toolCallId = asString(item.id) ?? `mcp-${Date.now()}`;
  const error = asString(asRecord(item.error)?.message) ?? asString(item.error);
  const resultPreview = getMcpResultPreview(item);

  const events: CanonicalEvent[] = mapMcpToolCallUpdated(item, context);
  events.push({
    kind: "agent.tool_call.result",
    toolCallId,
    toolName,
    success: !error,
    outputPreview: (error ?? resultPreview ?? "").slice(0, 300) || undefined,
  });
  return events;
};

// ---- Web search ----

const mapWebSearchUpdated = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolCallId = asString(item.id) ?? `web-${Date.now()}`;
  const query = asString(item.query);
  if (!query || !shouldEmitToolStart(context, toolCallId)) return [];

  return [{
    kind: "agent.tool_call.start",
    toolName: "WebSearch",
    toolCallId,
    inputPreview: query.slice(0, 300),
  }];
};

const mapWebSearchCompleted = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolCallId = asString(item.id) ?? `web-${Date.now()}`;
  const query = asString(item.query) ?? "Web search";
  const events = mapWebSearchUpdated(item, context);
  events.push({
    kind: "agent.tool_call.result",
    toolCallId,
    toolName: "WebSearch",
    success: true,
    outputPreview: query.slice(0, 300),
  });
  return events;
};

// ---- Command execution → bash events (in addition to text) ----

const mapCommandExecutionBashEvents = (
  item: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CanonicalEvent[] => {
  const toolCallId = asString(item.id) ?? `cmd-${Date.now()}`;
  const command = getCommand(item);
  if (!command || !shouldEmitToolStart(context, toolCallId)) return [];

  return [
    {
      kind: "agent.tool_call.start",
      toolName: "Bash",
      toolCallId,
      inputPreview: command.slice(0, 100),
    },
    {
      kind: "agent.bash.execute",
      toolCallId,
      command,
    },
  ];
};

// ---- Approval → question ----

const toQuestionEvent = (event: Record<string, unknown>): CanonicalEvent => {
  const question =
    asString(event.reason) ??
    asString(event.message) ??
    "Approval requested by Codex";
  const options = Array.isArray(event.options)
    ? event.options.map(String)
    : ["allow", "deny"];

  return {
    kind: "agent.question",
    questionText: question,
    options,
  };
};

// ---- Public mapper ----

export const mapCodexToCanonical = (
  _sessionId: string,
  event: Record<string, unknown>,
  context: CodexCanonicalMappingContext,
): CodexCanonicalMappingResult => {
  const eventType = normalizeType(event);
  const item = asRecord(event.item);
  const itemType = asString(item?.type);

  // --- item.updated ---
  if (eventType === "item.updated" && item) {
    if (itemType === "agent_message") {
      return { events: mapAgentMessageUpdated(item, context) };
    }
    if (itemType === "reasoning") {
      return { events: mapReasoningUpdated(item, context) };
    }
    if (itemType === "command_execution") {
      const textEvents = mapCommandExecutionUpdated(item, context);
      const bashEvents = mapCommandExecutionBashEvents(item, context);
      return { events: [...bashEvents, ...textEvents] };
    }
    if (itemType === "file_change") {
      return { events: mapFileChangeUpdated(item, context) };
    }
    if (itemType === "mcp_tool_call") {
      return { events: mapMcpToolCallUpdated(item, context) };
    }
    if (itemType === "web_search") {
      return { events: mapWebSearchUpdated(item, context) };
    }
  }

  // --- item.completed ---
  if (eventType === "item.completed" && item) {
    if (itemType === "agent_message") {
      return { events: mapAgentMessageCompleted(item, context) };
    }
    if (itemType === "reasoning") {
      return { events: mapReasoningCompleted(item, context) };
    }
    if (itemType === "command_execution") {
      const bashEvents = mapCommandExecutionBashEvents(item, context);
      const textEvents = mapCommandExecutionCompleted(item, context);
      const toolCallId = asString(item.id) ?? `cmd-${Date.now()}`;
      const command = getCommand(item);
      const resultEvents: CanonicalEvent[] = command ? [{
        kind: "agent.tool_call.result",
        toolCallId,
        toolName: "Bash",
        success: true,
        outputPreview: getCommandDisplayText(item)?.slice(0, 200),
      }] : [];
      return { events: [...bashEvents, ...textEvents, ...resultEvents] };
    }
    if (itemType === "file_change") {
      return { events: mapFileChangeCompleted(item, context) };
    }
    if (itemType === "mcp_tool_call") {
      return { events: mapMcpToolCallCompleted(item, context) };
    }
    if (itemType === "web_search") {
      return { events: mapWebSearchCompleted(item, context) };
    }
  }

  // --- Turn lifecycle ---
  if (eventType === "turn.completed" || eventType === "completed") {
    const usageMetadata: Record<string, unknown> = {};
    const usage = asRecord(event.usage);
    if (usage) {
      usageMetadata.usage = usage;
    }

    return {
      events: [
        {
          kind: "session.idle",
          hasBackgroundAgents: false,
          isPlanningJob: false,
          ...(Object.keys(usageMetadata).length > 0 ? { metadata: usageMetadata } : {}),
        },
      ],
      terminal: true,
    };
  }

  if (eventType === "turn.failed" || eventType === "error") {
    return {
      events: [
        {
          kind: "session.error",
          message: getErrorMessage(event),
          recoverable: false,
        },
        {
          kind: "session.idle",
          hasBackgroundAgents: false,
          isPlanningJob: false,
        },
      ],
      terminal: true,
    };
  }

  // --- Approval ---
  if (eventType.includes("approval")) {
    return {
      events: [toQuestionEvent(event)],
      requiresInput: true,
    };
  }

  // --- Generic error ---
  if (eventType.includes("error")) {
    return {
      events: [
        {
          kind: "session.error",
          message: getErrorMessage(event),
          recoverable: true,
        },
      ],
    };
  }

  return { events: [] };
};
