import type { SSEEvent } from "@almirant/shim-server";
import type { ThreadEvent } from "@openai/codex-sdk";

type CodexEvent = ThreadEvent | Record<string, unknown>;

export type CodexMappingContext = {
  messageSnapshots: Map<string, string>;
};

type MappingResult = {
  events: SSEEvent[];
  terminal?: boolean;
};

const INTERNAL_ITEM_TYPES = new Set(["todo_list"]);

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
};

const normalizeType = (event: CodexEvent): string => {
  const payload = asRecord(event);
  if (!payload) {
    return "";
  }

  return (
    asString(payload.type) ??
    asString(payload.event) ??
    asString(payload.method) ??
    ""
  );
};

const getErrorMessage = (event: CodexEvent): string => {
  const payload = asRecord(event);
  if (!payload) {
    return "Codex runtime error";
  }

  const nestedError = asRecord(payload.error);
  return (
    asString(payload.message) ??
    asString(payload.error) ??
    asString(nestedError?.message) ??
    "Codex runtime error"
  );
};

const toQuestionAskedEvent = (
  sessionId: string,
  event: CodexEvent
): SSEEvent => {
  const payload = asRecord(event);
  const question =
    asString(payload?.reason) ??
    asString(payload?.message) ??
    "Approval requested by Codex";
  const options = Array.isArray(payload?.options)
    ? payload.options.map(String)
    : ["allow", "deny"];

  return {
    type: "question.asked",
    properties: {
      sessionId,
      text: question,
      options,
    },
  };
};

const mapAgentMessageUpdated = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__default";
  const text = asString(item.text);
  if (!text) {
    return [];
  }

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [
        {
          type: "message.part.delta",
          properties: {
            sessionId,
            delta,
            contentType: "text",
          },
        },
      ];
    }

    return [];
  }

  return [
    {
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "text",
        part: {
          text,
        },
      },
    },
  ];
};

const mapAgentMessageCompleted = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__default";
  const text = asString(item.text);
  if (!text) {
    return [];
  }

  context.messageSnapshots.set(itemId, text);
  return [
    {
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "text",
        part: {
          text,
        },
      },
    },
  ];
};

const mapReasoningUpdated = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__reasoning";
  const text = asString(item.text);
  if (!text) {
    return [];
  }

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [
        {
          type: "message.part.delta",
          properties: {
            sessionId,
            delta,
            contentType: "thinking",
          },
        },
      ];
    }

    return [];
  }

  return [
    {
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "thinking",
        part: {
          text,
        },
      },
    },
  ];
};

const mapReasoningCompleted = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__reasoning";
  const text = asString(item.text);
  if (!text) {
    return [];
  }

  context.messageSnapshots.set(itemId, text);
  return [
    {
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "thinking",
        part: {
          text,
        },
      },
    },
  ];
};

/**
 * Extract display text from a command_execution item.
 * The Codex SDK uses `command` (the shell command) and `aggregated_output`
 * (stdout/stderr), NOT `text`.
 */
const getCommandText = (item: Record<string, unknown>): string | undefined => {
  const command = asString(item.command);
  const output = asString(item.aggregated_output);
  // Fallback to `text` for backward compat
  const text = asString(item.text);
  if (command && output) return `$ ${command}\n${output}`;
  if (command) return `$ ${command}`;
  if (output) return output;
  return text;
};

const mapCommandExecutionUpdated = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__command";
  const text = getCommandText(item);
  if (!text) return [];

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [
        {
          type: "message.part.delta",
          properties: { sessionId, delta, contentType: "text" },
        },
      ];
    }
    return [];
  }

  return [
    {
      type: "message.part.updated",
      properties: { sessionId, contentType: "text", part: { text } },
    },
  ];
};

const mapCommandExecutionCompleted = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__command";
  const text = getCommandText(item);
  if (!text) return [];

  context.messageSnapshots.set(itemId, text);
  return [
    {
      type: "message.part.updated",
      properties: { sessionId, contentType: "text", part: { text } },
    },
  ];
};

/**
 * Map generic item types (file_change, mcp_tool_call, etc.) to text events
 * so the user can see what's happening.
 */
const mapGenericItemToText = (
  sessionId: string,
  item: Record<string, unknown>,
  context: CodexMappingContext,
  isComplete: boolean,
): SSEEvent[] => {
  const itemId = asString(item.id) ?? "__generic";
  const itemType = asString(item.type) ?? "unknown";

  // Build a human-readable summary from item fields
  let text = "";
  if (itemType === "file_change") {
    const filePath = asString(item.file_path) ?? asString(item.path) ?? "";
    const action = asString(item.action) ?? "modified";
    text = filePath ? `[${action}] ${filePath}` : `[file_change]`;
  } else if (itemType === "mcp_tool_call") {
    const toolName = asString(item.tool_name) ?? asString(item.name) ?? "tool";
    const serverName = asString(item.server_name) ?? "";
    text = serverName ? `[mcp] ${serverName}/${toolName}` : `[mcp] ${toolName}`;
  } else {
    // Fallback: try text, message, or just the type name
    text = asString(item.text) ?? asString(item.message) ?? `[${itemType}]`;
  }

  if (!text) return [];

  if (isComplete) {
    context.messageSnapshots.set(itemId, text);
    return [
      {
        type: "message.part.updated",
        properties: { sessionId, contentType: "text", part: { text } },
      },
    ];
  }

  const previous = context.messageSnapshots.get(itemId) ?? "";
  context.messageSnapshots.set(itemId, text);

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (delta.length > 0) {
      return [
        {
          type: "message.part.delta",
          properties: { sessionId, delta, contentType: "text" },
        },
      ];
    }
    return [];
  }

  return [
    {
      type: "message.part.updated",
      properties: { sessionId, contentType: "text", part: { text } },
    },
  ];
};

export const mapCodexEventToSse = (
  sessionId: string,
  event: CodexEvent,
  context: CodexMappingContext
): MappingResult => {
  const eventType = normalizeType(event);
  const payload = asRecord(event);
  const item = asRecord(payload?.item);
  const itemType = asString(item?.type);

  if (eventType === "item.updated" && itemType === "agent_message" && item) {
    return {
      events: mapAgentMessageUpdated(sessionId, item, context),
    };
  }

  if (eventType === "item.completed" && itemType === "agent_message" && item) {
    return {
      events: mapAgentMessageCompleted(sessionId, item, context),
    };
  }

  if (eventType === "item.updated" && itemType === "reasoning" && item) {
    return {
      events: mapReasoningUpdated(sessionId, item, context),
    };
  }

  if (eventType === "item.completed" && itemType === "reasoning" && item) {
    return {
      events: mapReasoningCompleted(sessionId, item, context),
    };
  }

  if (
    eventType === "item.updated" &&
    itemType === "command_execution" &&
    item
  ) {
    return {
      events: mapCommandExecutionUpdated(sessionId, item, context),
    };
  }

  if (
    eventType === "item.completed" &&
    itemType === "command_execution" &&
    item
  ) {
    return {
      events: mapCommandExecutionCompleted(sessionId, item, context),
    };
  }

  // Exclude user_message items — these are inputs (the prompt), not agent output.
  // Without this guard the skill prompt leaks into the transcript as if the agent wrote it.
  if (
    (eventType === "item.updated" || eventType === "item.completed") &&
    (itemType === "user_message" || INTERNAL_ITEM_TYPES.has(itemType ?? ""))
  ) {
    return { events: [] };
  }

  // file_change, mcp_tool_call, and web_search are handled as canonical
  // tool_call events by the canonical-mapper (emitted via onCanonicalEvent).
  // Skip text mapping for these to avoid duplicate rendering in the frontend.
  if (
    (eventType === "item.updated" || eventType === "item.completed") &&
    (itemType === "file_change" || itemType === "mcp_tool_call" || itemType === "web_search")
  ) {
    return { events: [] };
  }

  // Handle other item types as text fallback
  if ((eventType === "item.updated" || eventType === "item.completed") && item && itemType) {
    return {
      events: mapGenericItemToText(sessionId, item, context, eventType === "item.completed"),
    };
  }

  // item.started — acknowledge but don't produce events (the item will be
  // emitted when updated/completed with actual content)
  if (eventType === "item.started") {
    return { events: [] };
  }

  // thread.started / turn.started — lifecycle events, no user-visible output
  if (eventType === "thread.started" || eventType === "turn.started") {
    return { events: [] };
  }

  if (eventType === "turn.completed" || eventType === "completed") {
    return {
      events: [
        {
          type: "session.idle",
          properties: { sessionId },
        },
      ],
      terminal: true,
    };
  }

  if (eventType === "turn.failed" || eventType === "error") {
    return {
      events: [
        {
          type: "session.status",
          properties: {
            sessionId,
            status: "error",
            message: getErrorMessage(event),
          },
        },
        {
          type: "session.idle",
          properties: { sessionId },
        },
      ],
      terminal: true,
    };
  }

  if (eventType.includes("approval")) {
    return {
      events: [toQuestionAskedEvent(sessionId, event)],
    };
  }

  if (eventType.includes("error")) {
    return {
      events: [
        {
          type: "session.status",
          properties: {
            sessionId,
            status: "error",
            message: getErrorMessage(event),
          },
        },
      ],
    };
  }

  return { events: [] };
};
