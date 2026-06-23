import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { SessionEventRecord } from "@/domains/sessions/domain/types";

type ToolPresentationOverride = {
  toolName: "Read" | "Write" | "Edit" | "Glob" | "Grep";
  inputPreview?: string;
  filePath?: string;
  lineRange?: string;
};

const toString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const isInjectedPromptEchoText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^IMPORTANT:\s+You MUST respond in\b[\s\S]*\n\n\/[a-z][\w-]+(?:\s|$)/i.test(trimmed)) {
    return true;
  }

  return (
    /^You are implementing work item\b/i.test(trimmed) &&
    /##\s+Task Details\b/i.test(trimmed) &&
    /##\s+Working Directory\b/i.test(trimmed) &&
    /##\s+Instructions\b/i.test(trimmed)
  );
};

const GENERIC_MCP_TOOL_NAMES = new Set(["mcp_tool", "MCP tool"]);

const toPreview = (payload: Record<string, unknown>): string | undefined => {
  const inputPreview = toString(payload.inputPreview);
  if (inputPreview) return inputPreview;

  const command = toString(payload.command);
  if (command) return command;

  const filePath = toString(payload.filePath);
  if (filePath) return filePath;

  const description = toString(payload.description);
  if (description) return description;

  return undefined;
};

const extractJsonRecord = (
  value: string | undefined,
): Record<string, unknown> | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
};

const buildMcpToolName = (
  server: string | null,
  action: string | null,
): string | null => {
  if (!server || !action) return null;
  if (action.startsWith("mcp__")) return action;
  const normalizedServer = server.replace(/^mcp__/, "").trim();
  const normalizedAction = action.replace(/^__+/, "").trim();
  if (!normalizedServer || !normalizedAction) return null;
  return `mcp__${normalizedServer}__${normalizedAction}`;
};

const normalizeToolName = (
  toolName: string,
  preview?: string,
): string => {
  if (toolName.startsWith("mcp__")) return toolName;
  if (!GENERIC_MCP_TOOL_NAMES.has(toolName)) return toolName;

  const parsed = extractJsonRecord(preview);
  if (parsed) {
    const explicitName =
      toString(parsed.name) ??
      toString(parsed.toolName) ??
      toString(parsed.tool_name);
    if (explicitName?.startsWith("mcp__")) return explicitName;

    const nestedInput =
      typeof parsed.input === "object" && parsed.input !== null && !Array.isArray(parsed.input)
        ? (parsed.input as Record<string, unknown>)
        : typeof parsed.arguments === "object" && parsed.arguments !== null && !Array.isArray(parsed.arguments)
          ? (parsed.arguments as Record<string, unknown>)
          : typeof parsed.params === "object" && parsed.params !== null && !Array.isArray(parsed.params)
            ? (parsed.params as Record<string, unknown>)
            : null;

    const source = nestedInput ?? parsed;
    const normalized = buildMcpToolName(
      toString(source.server) ??
        toString(source.serverName) ??
        toString(source.server_name),
      toString(source.tool) ??
        toString(source.toolName) ??
        toString(source.tool_name) ??
        toString(source.name),
    );
    if (normalized) return normalized;
  }

  const explicitNameMatch = preview?.match(
    /"(?:name|toolName|tool_name)"\s*:\s*"(mcp__[^"]+)"/,
  );
  if (explicitNameMatch?.[1]) return explicitNameMatch[1];

  const serverMatch = preview?.match(
    /"(?:server|serverName|server_name)"\s*:\s*"([^"]+)"/,
  );
  const toolMatch = preview?.match(
    /"(?:tool|toolName|tool_name|name)"\s*:\s*"([^"]+)"/,
  );
  return buildMcpToolName(serverMatch?.[1] ?? null, toolMatch?.[1] ?? null) ?? toolName;
};

const toMetadataRecord = (
  payload: Record<string, unknown>,
): Record<string, unknown> | null => {
  const metadata = payload.metadata;
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : null;
};

const getCommandExecutionToolCallId = (
  payload: Record<string, unknown>,
): string | null => {
  return toString(toMetadataRecord(payload)?.toolCallId);
};

const isCommandExecutionTextPayload = (
  payload: Record<string, unknown>,
): boolean => {
  return toMetadataRecord(payload)?.source === "command_execution";
};

const normalizeCommandTranscript = (text: string): string =>
  text.startsWith("\n") ? text.slice(1) : text;

const extractCommandLine = (text: string): string | null => {
  const normalized = normalizeCommandTranscript(text);
  if (!normalized.startsWith("$ ")) return null;
  const firstNewline = normalized.indexOf("\n");
  const command = firstNewline === -1
    ? normalized.slice(2)
    : normalized.slice(2, firstNewline);
  return command.trim() || null;
};

const extractCommandOutput = (text: string): string => {
  const normalized = normalizeCommandTranscript(text);
  if (!normalized.startsWith("$ ")) return normalized;
  const firstNewline = normalized.indexOf("\n");
  if (firstNewline === -1) return "";
  return normalized.slice(firstNewline + 1);
};

const buildBashEventKey = (timestamp: string, command: string): string =>
  `${timestamp}::${command}`;

const BASH_TRANSCRIPT_LOOKAHEAD = 3;

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === "\"" && last === "\"")) {
    return value.slice(1, -1);
  }
  return value;
};

const unwrapShellCommand = (command: string): string => {
  const trimmed = command.trim();
  const shellWrapperMatch = trimmed.match(
    /^(?:(?:\/usr\/bin\/env\s+)?(?:\/bin\/)?(?:bash|sh|zsh))\s+-lc\s+([\s\S]+)$/i,
  );
  if (!shellWrapperMatch?.[1]) return trimmed;
  return stripMatchingQuotes(shellWrapperMatch[1].trim());
};

const getPrimaryShellSegment = (command: string): string => {
  const unwrapped = unwrapShellCommand(command).trim();
  const [primary] = unwrapped.split(/\s*(?:\|\||&&|;|\|)\s*/);
  return primary?.trim() ?? unwrapped;
};

const tokenizeShellLike = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
};

const getLastPositionalToken = (tokens: string[]): string | undefined => {
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-")) continue;
    return token;
  }
  return undefined;
};

const getFirstQuotedValue = (command: string): string | undefined => {
  const normalized = command
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
  const match = normalized.match(/(["'])(.*?)\1/);
  return match?.[2]?.trim() || undefined;
};

const inferReadDisplay = (
  segment: string,
  tokens: string[],
): ToolPresentationOverride | null => {
  const commandName = tokens[0];
  if (!commandName) return null;

  if (commandName === "sed") {
    if (!tokens.includes("-n")) return null;
    const rangeToken = tokens.find((token) => /^\d+(?:,\d+)?p$/.test(token));
    const filePath = getLastPositionalToken(tokens);
    if (!filePath) {
      return {
        toolName: "Read",
        inputPreview: segment.slice(0, 120),
      };
    }

    const lineRange = rangeToken?.replace(/p$/, "").replace(",", "-");
    return {
      toolName: "Read",
      filePath,
      lineRange,
      inputPreview: lineRange ? `${filePath}:${lineRange}` : filePath,
    };
  }

  const filePath = getLastPositionalToken(tokens);
  if (!filePath) {
    return {
      toolName: "Read",
      inputPreview: segment.slice(0, 120),
    };
  }

  return {
    toolName: "Read",
    filePath,
    inputPreview: filePath,
  };
};

const inferGlobDisplay = (
  segment: string,
  tokens: string[],
): ToolPresentationOverride | null => {
  if (tokens[0] === "find") {
    const searchRoot = tokens[1];
    return {
      toolName: "Glob",
      inputPreview: searchRoot || segment.slice(0, 120),
      filePath: searchRoot,
    };
  }

  if (tokens[0] === "rg" && tokens.includes("--files")) {
    const filesFlagIndex = tokens.indexOf("--files");
    const searchRoot = tokens
      .slice(filesFlagIndex + 1)
      .find((token) => token && !token.startsWith("-"));
    return {
      toolName: "Glob",
      inputPreview: searchRoot || segment.slice(0, 120),
      filePath: searchRoot,
    };
  }

  if (tokens[0] === "fd") {
    const searchRoot = getLastPositionalToken(tokens);
    return {
      toolName: "Glob",
      inputPreview: searchRoot || segment.slice(0, 120),
      filePath: searchRoot,
    };
  }

  return null;
};

const inferGrepDisplay = (
  segment: string,
  tokens: string[],
): ToolPresentationOverride | null => {
  const query = getFirstQuotedValue(segment);
  if (query) {
    return {
      toolName: "Grep",
      inputPreview: query,
    };
  }

  const searchTerm = tokens
    .slice(tokens[0] === "git" ? 2 : 1)
    .find((token) => token && !token.startsWith("-"));

  return {
    toolName: "Grep",
    inputPreview: searchTerm || segment.slice(0, 120),
  };
};

const inferEditDisplay = (
  segment: string,
  tokens: string[],
): ToolPresentationOverride | null => {
  const filePath = getLastPositionalToken(tokens);
  return {
    toolName: "Edit",
    inputPreview: filePath || segment.slice(0, 120),
    filePath,
  };
};

const inferToolPresentationFromCommand = (
  command: string,
): ToolPresentationOverride | null => {
  const primarySegment = getPrimaryShellSegment(command);
  const tokens = tokenizeShellLike(primarySegment);
  const commandName = tokens[0];
  if (!commandName) return null;

  if (commandName === "find" || commandName === "fd") {
    return inferGlobDisplay(primarySegment, tokens);
  }

  if (commandName === "rg") {
    if (tokens.includes("--files")) {
      return inferGlobDisplay(primarySegment, tokens);
    }
    return inferGrepDisplay(primarySegment, tokens);
  }

  if (commandName === "grep" || (commandName === "git" && tokens[1] === "grep")) {
    return inferGrepDisplay(primarySegment, tokens);
  }

  if (["cat", "head", "tail", "less", "more", "nl"].includes(commandName)) {
    return inferReadDisplay(primarySegment, tokens);
  }

  if (commandName === "sed") {
    if (tokens.some((token) => token === "-i" || /^-i(?:.+)?$/.test(token))) {
      return inferEditDisplay(primarySegment, tokens);
    }
    if (tokens.includes("-n")) {
      return inferReadDisplay(primarySegment, tokens);
    }
  }

  if (commandName === "perl" && tokens.some((token) => token.includes("-pi"))) {
    return inferEditDisplay(primarySegment, tokens);
  }

  return null;
};

const inferToolPresentationFromFileChangePreview = (
  preview: string,
): ToolPresentationOverride | null => {
  const match = preview.match(/^(?:File\s+)?(add|create|update|delete|remove):\s+(.+)$/i);
  if (!match) return null;

  const operation = match[1]?.toLowerCase();
  const filePath = match[2]?.trim();
  if (!filePath) return null;

  return {
    toolName: operation === "add" || operation === "create" ? "Write" : "Edit",
    inputPreview: filePath,
    filePath,
  };
};

const buildToolPresentationOverrides = (
  sessionEvents: SessionEventRecord[],
): Map<string, ToolPresentationOverride> => {
  const overrides = new Map<string, ToolPresentationOverride>();

  for (const event of sessionEvents) {
    const payload = event.payload ?? {};
    const toolCallId = toString(payload.toolCallId);

    if (!toolCallId) continue;

    if (event.kind === "agent.bash.execute") {
      const command = toString(payload.command);
      if (!command) continue;
      const inferred = inferToolPresentationFromCommand(command);
      if (inferred) overrides.set(toolCallId, inferred);
      continue;
    }

    if (event.kind === "agent.file.read" || event.kind === "agent.file.write" || event.kind === "agent.file.edit") {
      const filePath = toString(payload.filePath) ?? undefined;
      overrides.set(toolCallId, {
        toolName:
          event.kind === "agent.file.read"
            ? "Read"
            : event.kind === "agent.file.write"
              ? "Write"
              : "Edit",
        inputPreview: filePath,
        filePath,
      });
      continue;
    }
  }

  return overrides;
};

const getToolPresentationOverride = (
  toolName: string | null,
  toolCallId: string | null,
  payload: Record<string, unknown>,
  toolPresentationOverrides: Map<string, ToolPresentationOverride>,
): ToolPresentationOverride | null => {
  if (toolCallId) {
    const override = toolPresentationOverrides.get(toolCallId);
    if (override) return override;
  }

  if (toolName === "Bash") {
    const inputPreview = toString(payload.inputPreview);
    if (inputPreview) {
      return inferToolPresentationFromCommand(inputPreview);
    }

    const outputPreview = toString(payload.outputPreview);
    if (outputPreview?.startsWith("$ ")) {
      const command = outputPreview.slice(2).split("\n")[0] ?? "";
      return inferToolPresentationFromCommand(command);
    }
  }

  if (toolName === "FileChange") {
    const inputPreview = toString(payload.inputPreview);
    if (inputPreview) {
      return inferToolPresentationFromFileChangePreview(inputPreview);
    }

    const outputPreview = toString(payload.outputPreview);
    if (outputPreview) {
      return inferToolPresentationFromFileChangePreview(outputPreview);
    }
  }

  return null;
};

const findHistoricalBashToolCallId = (
  event: SessionEventRecord,
  text: string,
  bashToolCallIdsByTimestampAndCommand: Map<string, string>,
): string | null => {
  const command = extractCommandLine(text);
  if (!command) return null;
  return bashToolCallIdsByTimestampAndCommand.get(
    buildBashEventKey(event.createdAt, command),
  ) ?? null;
};

const buildHistoricalTranscriptToolCallIdsByEventId = (
  sessionEvents: SessionEventRecord[],
): Map<string, string> => {
  const bashExecutionsByCommand = new Map<
    string,
    Array<{ sequenceNum: number; toolCallId: string }>
  >();

  for (const event of sessionEvents) {
    if (event.kind !== "agent.bash.execute") continue;
    const command = toString(event.payload?.command);
    const toolCallId = toString(event.payload?.toolCallId);
    if (!command || !toolCallId) continue;

    if (!bashExecutionsByCommand.has(command)) {
      bashExecutionsByCommand.set(command, []);
    }
    bashExecutionsByCommand.get(command)!.push({
      sequenceNum: event.sequenceNum,
      toolCallId,
    });
  }

  const associations = new Map<string, string>();

  for (const event of sessionEvents) {
    if (event.kind !== "agent.text" && event.kind !== "agent.text.complete") {
      continue;
    }

    const text =
      toString(event.payload?.fullText) ??
      toString(event.payload?.content) ??
      "";
    const command = extractCommandLine(text);
    if (!command) continue;

    const candidates = bashExecutionsByCommand.get(command);
    const match = candidates?.find(
      (candidate) =>
        candidate.sequenceNum > event.sequenceNum &&
        candidate.sequenceNum - event.sequenceNum <= BASH_TRANSCRIPT_LOOKAHEAD,
    );

    if (match) {
      associations.set(event.id, match.toolCallId);
    }
  }

  return associations;
};

const toToolUseChunk = (
  event: SessionEventRecord,
  toolName: string,
  message: string,
  extraPayload: Record<string, unknown> = {},
): AgentLogChunk => ({
  id: `${event.id}-${event.sequenceNum}`,
  seq: event.sequenceNum,
  level: "info",
  phase: "transcript",
  eventType: "tool_use",
  message,
  contentType: "tool_use",
  payload: {
    ...extraPayload,
    toolName,
    toolCallId: toString(extraPayload.toolCallId) ?? event.id,
  },
  timestamp: event.createdAt,
});

const toTextChunk = (
  event: SessionEventRecord,
  eventType: string,
  message: string,
  contentType: AgentLogChunk["contentType"] = "text",
): AgentLogChunk => ({
  id: `${event.id}-${event.sequenceNum}`,
  seq: event.sequenceNum,
  level: "info",
  phase: "transcript",
  eventType,
  message,
  contentType,
  payload: event.payload,
  timestamp: event.createdAt,
});

const toLifecycleChunk = (
  event: SessionEventRecord,
  phase: string,
  eventType: string,
  message = "",
  payload: Record<string, unknown> = {},
): AgentLogChunk => ({
  id: `${event.id}-${event.sequenceNum}`,
  seq: event.sequenceNum,
  level: "info",
  phase,
  eventType,
  message,
  payload,
  timestamp: event.createdAt,
});

const toBashChunk = (
  event: SessionEventRecord,
  toolCallId: string,
  command: string,
  description?: string,
): AgentLogChunk => ({
  id: `${event.id}-${event.sequenceNum}`,
  seq: event.sequenceNum,
  level: "info",
  phase: "transcript",
  eventType: "agent.bash.execute",
  message: command,
  payload: {
    toolCallId,
    command,
    ...(description ? { description } : {}),
  },
  timestamp: event.createdAt,
});

const toBashOutputChunk = (
  event: SessionEventRecord,
  toolCallId: string,
  output: string,
): AgentLogChunk => ({
  id: `${event.id}-${event.sequenceNum}`,
  seq: event.sequenceNum,
  level: "info",
  phase: "transcript",
  eventType: "agent.bash.output",
  message: output,
  payload: {
    toolCallId,
    output,
  },
  timestamp: event.createdAt,
});

const mapSessionEventToChunk = (
  event: SessionEventRecord,
  bashToolCallIdsByTimestampAndCommand: Map<string, string>,
  historicalTranscriptToolCallIdsByEventId: Map<string, string>,
  toolPresentationOverrides: Map<string, ToolPresentationOverride>,
  startedToolCallIds: Set<string>,
): AgentLogChunk | null => {
  const payload = event.payload ?? {};

  switch (event.kind) {
    case "agent.thinking":
      return toTextChunk(
        event,
        "agent.thinking",
        toString(payload.content) ?? "",
        "thinking",
      );

    case "agent.text": {
      const content = toString(payload.content) ?? "";
      if (isInjectedPromptEchoText(content)) {
        return null;
      }
      if (isCommandExecutionTextPayload(payload)) {
        const toolCallId = getCommandExecutionToolCallId(payload);
        if (toolCallId && toolPresentationOverrides.has(toolCallId)) {
          return null;
        }
        const output = extractCommandOutput(content);
        if (toolCallId && output) {
          return toBashOutputChunk(event, toolCallId, output);
        }
        return null;
      }
      const historicalBashToolCallId = findHistoricalBashToolCallId(
        event,
        content,
        bashToolCallIdsByTimestampAndCommand,
      ) ?? historicalTranscriptToolCallIdsByEventId.get(event.id) ?? null;
      if (historicalBashToolCallId) {
        if (toolPresentationOverrides.has(historicalBashToolCallId)) {
          return null;
        }
        const output = extractCommandOutput(content);
        return output
          ? toBashOutputChunk(event, historicalBashToolCallId, output)
          : null;
      }
      return toTextChunk(event, "agent.text", content);
    }

    case "agent.text.complete": {
      const fullText = toString(payload.fullText) ?? toString(payload.content) ?? "";
      if (isInjectedPromptEchoText(fullText)) {
        return null;
      }
      if (isCommandExecutionTextPayload(payload)) {
        const toolCallId = getCommandExecutionToolCallId(payload);
        if (toolCallId && toolPresentationOverrides.has(toolCallId)) {
          return null;
        }
        const output = extractCommandOutput(fullText);
        if (toolCallId && output) {
          return toBashOutputChunk(event, toolCallId, output);
        }
        return null;
      }
      const historicalBashToolCallId = findHistoricalBashToolCallId(
        event,
        fullText,
        bashToolCallIdsByTimestampAndCommand,
      ) ?? historicalTranscriptToolCallIdsByEventId.get(event.id) ?? null;
      if (historicalBashToolCallId) {
        if (toolPresentationOverrides.has(historicalBashToolCallId)) {
          return null;
        }
        const output = extractCommandOutput(fullText);
        return output
          ? toBashOutputChunk(event, historicalBashToolCallId, output)
          : null;
      }
      return toTextChunk(
        event,
        "agent.text.complete",
        fullText,
      );
    }

    case "agent.tool_call.start": {
      const preview = toPreview(payload);
      const rawToolName = normalizeToolName(
        toString(payload.toolName) ?? "mcp_tool",
        preview,
      );
      const toolCallId = toString(payload.toolCallId) ?? event.id;
      const override = getToolPresentationOverride(
        rawToolName,
        toolCallId,
        payload,
        toolPresentationOverrides,
      );
      return toToolUseChunk(
        event,
        override?.toolName ?? rawToolName,
        override?.inputPreview ?? preview ?? "",
        {
          toolCallId,
          inputPreview: override?.inputPreview ?? preview,
          ...(override?.filePath ? { filePath: override.filePath } : {}),
          ...(override?.lineRange ? { lineRange: override.lineRange } : {}),
        },
      );
    }

    case "agent.bash.execute":
      if (!toString(payload.command)) return null;
      {
        const toolCallId = toString(payload.toolCallId) ?? event.id;
        const override = toolPresentationOverrides.get(toolCallId);
        if (override) {
          if (startedToolCallIds.has(toolCallId)) {
            return null;
          }
          return toToolUseChunk(
            event,
            override.toolName,
            override.inputPreview ?? toString(payload.command) ?? override.toolName,
            {
              toolCallId,
              inputPreview: override.inputPreview,
              ...(override.filePath ? { filePath: override.filePath } : {}),
              ...(override.lineRange ? { lineRange: override.lineRange } : {}),
            },
          );
        }
      }
      return toBashChunk(
        event,
        toString(payload.toolCallId) ?? event.id,
        toString(payload.command)!,
        toString(payload.description) ?? undefined,
      );

    case "agent.bash.output":
      if (!toString(payload.output)) return null;
      if (toolPresentationOverrides.has(toString(payload.toolCallId) ?? event.id)) {
        return null;
      }
      return toBashOutputChunk(
        event,
        toString(payload.toolCallId) ?? event.id,
        toString(payload.output)!,
      );

    case "agent.file.read":
      return toToolUseChunk(
        event,
        "Read",
        toString(payload.filePath) ?? "Read",
        {
          toolCallId: toString(payload.toolCallId) ?? event.id,
          filePath: toString(payload.filePath),
          inputPreview: toPreview(payload) ?? toString(payload.filePath) ?? undefined,
        },
      );

    case "agent.file.write":
      return toToolUseChunk(
        event,
        "Write",
        toString(payload.filePath) ?? "Write",
        {
          toolCallId: toString(payload.toolCallId) ?? event.id,
          filePath: toString(payload.filePath),
          inputPreview: toPreview(payload) ?? toString(payload.filePath) ?? undefined,
        },
      );

    case "agent.file.edit":
      return toToolUseChunk(
        event,
        "Edit",
        toString(payload.filePath) ?? "Edit",
        {
          toolCallId: toString(payload.toolCallId) ?? event.id,
          filePath: toString(payload.filePath),
          inputPreview: toPreview(payload) ?? toString(payload.filePath) ?? undefined,
        },
      );

    case "agent.subagent.spawn":
      return toLifecycleChunk(
        event,
        "transcript",
        "subagent.spawn",
        toString(payload.description) ?? "",
        {
          subagentId: toString(payload.subagentId) ?? event.id,
          isBackground: payload.isBackground === true,
          subagentType: toString(payload.subagentType) ?? undefined,
        },
      );

    case "agent.subagent.complete":
      return toLifecycleChunk(
        event,
        "transcript",
        "subagent.complete",
        "",
        {
          subagentId: toString(payload.subagentId) ?? event.id,
          success: payload.success !== false,
        },
      );

    case "agent.summary": {
      const text = toString(payload.text) ?? "";
      const section = toString(payload.section) === "Resumen" ? "Resumen" : "Summary";
      if (!text) return null;
      return toLifecycleChunk(event, "transcript", "agent.summary", text, {
        text,
        section,
      });
    }

    case "session.connected":
    case "session.idle":
    case "session.awaiting_user":
    case "session.error":
    case "session.closed":
      return toLifecycleChunk(event, "session", event.kind, toString(payload.message) ?? "");

    default:
      if (event.kind.startsWith("agent.")) {
        const text =
          toString(payload.fullText) ??
          toString(payload.content) ??
          toString(payload.message) ??
          "";
        if (!text) return null;
        return toTextChunk(event, event.kind, text);
      }
      return null;
  }
};

type MarkdownFenceState = {
  isOpen: boolean;
  endsWithStandaloneFenceLine: boolean;
};

const MARKDOWN_FENCE_LINE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

const getMarkdownFenceState = (text: string): MarkdownFenceState => {
  let openFence: { marker: "`" | "~"; length: number } | null = null;
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = MARKDOWN_FENCE_LINE_PATTERN.exec(line);
    if (!match) continue;

    const markerRun = match[1] ?? "";
    const marker = markerRun[0] as "`" | "~";
    const trailing = match[2] ?? "";

    if (!openFence) {
      openFence = { marker, length: markerRun.length };
      continue;
    }

    if (
      marker === openFence.marker &&
      markerRun.length >= openFence.length &&
      trailing.trim() === ""
    ) {
      openFence = null;
    }
  }

  const lastLine = lines[lines.length - 1] ?? "";
  const lastLineMatch = MARKDOWN_FENCE_LINE_PATTERN.exec(lastLine);

  return {
    isOpen: openFence !== null,
    endsWithStandaloneFenceLine:
      !!lastLineMatch && (lastLineMatch[2] ?? "").trim() === "",
  };
};

const shouldSeparateAfterMarkdownFence = (
  accumulatedText: string,
  nextText: string,
): boolean => {
  if (!accumulatedText || !nextText) return false;
  if (accumulatedText.endsWith("\n") || nextText.startsWith("\n")) return false;

  const fenceState = getMarkdownFenceState(accumulatedText);
  return fenceState.endsWithStandaloneFenceLine && !fenceState.isOpen;
};

const joinTextDeltasPreservingMarkdownBoundaries = (
  run: AgentLogChunk[],
): string => {
  return run.reduce((accumulated, chunk) => {
    const separator = shouldSeparateAfterMarkdownFence(
      accumulated,
      chunk.message,
    )
      ? "\n"
      : "";
    return `${accumulated}${separator}${chunk.message}`;
  }, "");
};

/**
 * Deduplicate assistant text and thinking chunks produced by the canonical stream.
 *
 * Some shims (notably opencode) emit thousands of incremental `agent.text` and
 * `agent.thinking` deltas per session. Rendering them one by one creates a
 * "fake typing" effect on rehydrated history and inflates DOM cost. For every
 * contiguous run of chunks of the same coalesce kind ("text" or "thinking"),
 * we keep a single chunk:
 *   - if any `agent.text.complete` chunk is present in a text run, its fullText wins;
 *   - otherwise the deltas are concatenated in order, preserving Markdown
 *     fence boundaries between separate canonical text events.
 * Runs are broken whenever the chunk kind changes or a non-coalesceable chunk
 * appears (tool_call, file ops, bash, etc.), so we never collapse across a
 * tool boundary.
 */
type CoalesceKind = "text" | "thinking";

const collapseConsecutiveTextChunks = (
  chunks: AgentLogChunk[],
): AgentLogChunk[] => {
  const coalesceKindOf = (chunk: AgentLogChunk): CoalesceKind | null => {
    if (
      chunk.contentType === "text" &&
      (chunk.eventType === "agent.text" ||
        chunk.eventType === "agent.text.complete")
    ) {
      return "text";
    }
    if (
      chunk.contentType === "thinking" &&
      chunk.eventType === "agent.thinking"
    ) {
      return "thinking";
    }
    return null;
  };

  const result: AgentLogChunk[] = [];
  let runStart = -1;
  let runKind: CoalesceKind | null = null;

  const flushRun = (endExclusive: number) => {
    if (runStart < 0) return;
    const run = chunks.slice(runStart, endExclusive);
    runStart = -1;
    runKind = null;
    if (run.length === 0) return;
    if (run.length === 1) {
      result.push(run[0]);
      return;
    }

    let finalText: string | null = null;
    for (let index = run.length - 1; index >= 0; index -= 1) {
      if (run[index].eventType === "agent.text.complete") {
        finalText = run[index].message;
        break;
      }
    }
    if (finalText == null) {
      finalText = joinTextDeltasPreservingMarkdownBoundaries(run);
    }

    const last = run[run.length - 1];
    result.push({ ...last, message: finalText });
  };

  for (let index = 0; index < chunks.length; index += 1) {
    const kind = coalesceKindOf(chunks[index]);
    if (kind != null) {
      if (runStart < 0) {
        runStart = index;
        runKind = kind;
      } else if (kind !== runKind) {
        flushRun(index);
        runStart = index;
        runKind = kind;
      }
    } else {
      flushRun(index);
      result.push(chunks[index]);
    }
  }
  flushRun(chunks.length);
  return result;
};

const buildToolCallResultFallbackChunk = (
  event: SessionEventRecord,
  toolPresentationOverrides: Map<string, ToolPresentationOverride>,
): AgentLogChunk[] => {
  const payload = event.payload ?? {};
  const outputPreview = toString(payload.outputPreview) ?? undefined;
  const toolName = normalizeToolName(
    toString(payload.toolName) ?? "mcp_tool",
    outputPreview,
  );
  const toolCallId = toString(payload.toolCallId);
  if (!toolName || !toolCallId) return [];

  const override = getToolPresentationOverride(
    toolName,
    toolCallId,
    payload,
    toolPresentationOverrides,
  );

  if (override) {
    return [
      toToolUseChunk(
        event,
        override.toolName,
        override.inputPreview ?? toolName,
        {
          toolCallId,
          inputPreview: override.inputPreview,
          ...(override.filePath ? { filePath: override.filePath } : {}),
          ...(override.lineRange ? { lineRange: override.lineRange } : {}),
        },
      ),
    ];
  }

  if (toolName === "Bash") {
    const preview = toString(payload.outputPreview) ?? "";
    const command = preview.startsWith("$ ")
      ? preview.slice(2).split("\n")[0] ?? ""
      : "";
    const output = extractCommandOutput(preview);

    if (!command) return [];

    return [
      toBashChunk(event, toolCallId, command),
      ...(output ? [toBashOutputChunk(event, toolCallId, output)] : []),
    ];
  }

  return [
    toToolUseChunk(
      event,
      toolName,
      toString(payload.outputPreview) ?? toolName,
      {
        toolCallId,
        inputPreview: outputPreview,
      },
    ),
  ];
};

export const buildSessionDisplayChunks = (
  rawChunks: AgentLogChunk[],
  sessionEvents: SessionEventRecord[],
  _provider: string | null | undefined,
): AgentLogChunk[] => {
  void _provider;

  if (sessionEvents.length === 0) {
    return rawChunks.filter(
      (chunk) =>
        !(chunk.phase === "session" && chunk.eventType === "prompt.sent"),
    );
  }

  const nonTranscriptChunks = rawChunks.filter(
    (chunk) =>
      chunk.phase !== "transcript" &&
      !(chunk.phase === "session" && chunk.eventType === "prompt.sent"),
  );

  const bashToolCallIdsByTimestampAndCommand = new Map<string, string>();
  const historicalTranscriptToolCallIdsByEventId =
    buildHistoricalTranscriptToolCallIdsByEventId(sessionEvents);
  const toolPresentationOverrides = buildToolPresentationOverrides(sessionEvents);
  const startedCanonicalToolCallIds = new Set(
    sessionEvents
      .filter((event) => event.kind === "agent.tool_call.start")
      .map((event) => toString(event.payload?.toolCallId))
      .filter((toolCallId): toolCallId is string => !!toolCallId),
  );
  for (const event of sessionEvents) {
    if (event.kind !== "agent.bash.execute") continue;
    const command = toString(event.payload?.command);
    const toolCallId = toString(event.payload?.toolCallId);
    if (!command || !toolCallId) continue;
    bashToolCallIdsByTimestampAndCommand.set(
      buildBashEventKey(event.createdAt, command),
      toolCallId,
    );
  }

  const canonicalChunks = collapseConsecutiveTextChunks(
    sessionEvents
      .map((event) =>
        mapSessionEventToChunk(
          event,
          bashToolCallIdsByTimestampAndCommand,
          historicalTranscriptToolCallIdsByEventId,
          toolPresentationOverrides,
          startedCanonicalToolCallIds,
        ),
      )
      .filter((chunk): chunk is AgentLogChunk => chunk !== null),
  );

  const startedToolCallIds = new Set(
    canonicalChunks
      .map((chunk) => toString(chunk.payload?.toolCallId))
      .filter((toolCallId): toolCallId is string => !!toolCallId),
  );

  const fallbackToolChunks = sessionEvents
    .filter((event) => event.kind === "agent.tool_call.result")
    .flatMap((event) => {
      const toolCallId = toString(event.payload?.toolCallId);
      if (!toolCallId || startedToolCallIds.has(toolCallId)) return [];
      startedToolCallIds.add(toolCallId);
      return buildToolCallResultFallbackChunk(event, toolPresentationOverrides);
    })
    .filter((chunk): chunk is AgentLogChunk => chunk !== null);

  const combined = [...nonTranscriptChunks, ...canonicalChunks, ...fallbackToolChunks];
  combined.sort((left, right) => {
    const timestampDiff =
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;

    const leftToolCallId = toString(left.payload?.toolCallId);
    const rightToolCallId = toString(right.payload?.toolCallId);
    if (leftToolCallId && leftToolCallId === rightToolCallId) {
      if (
        left.eventType === "agent.bash.execute" &&
        right.eventType === "agent.bash.output"
      ) {
        return -1;
      }
      if (
        left.eventType === "agent.bash.output" &&
        right.eventType === "agent.bash.execute"
      ) {
        return 1;
      }
    }

    return left.seq - right.seq;
  });

  return combined.map((chunk, index) => ({
    ...chunk,
    seq: index + 1,
  }));
};
