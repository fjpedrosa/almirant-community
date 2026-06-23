import type { Sql } from "postgres";
import type { DataBackfillDefinition } from "./runner";

export const OPENCODE_SESSION_EVENTS_BACKFILL_KEY = "2026-04-opencode-native-session-events";
const OPENCODE_SESSION_EVENTS_BACKFILL_CHECKSUM = "v1-opencode-native-canonical-replay";

export type OpenCodeNativeEventRow = {
  agentJobId: string;
  planningSessionId: string | null;
  sequenceNum: number;
  nativeEventType: string;
  provider: string | null;
  codingAgent: string | null;
  runtimeSessionId: string | null;
  payload: Record<string, unknown>;
  emittedAt: Date | string | null;
  receivedAt: Date | string;
};

export type BackfilledSessionEvent = {
  agentJobId: string;
  planningSessionId: string | null;
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown>;
  provider: string | null;
  createdAt: Date;
};

export type SessionEventProjection = {
  kind: string;
  payload: Record<string, unknown>;
};

type CanonicalEvent = Record<string, unknown> & { kind: string };

type OpenCodeReplayContext = {
  partSnapshots: Map<string, string>;
  partContentTypes: Map<string, "thinking" | "text" | "tool_use">;
  toolUseBuffers: Map<string, string>;
  activeTools: Map<string, { toolName: string; input?: Record<string, unknown>; rawInput?: string }>;
  emittedToolIds: Set<string>;
  activeSubagentIds: Set<string>;
};

type RowBackedCanonicalEvent = {
  event: CanonicalEvent;
  sourceRow: OpenCodeNativeEventRow;
};

const RICH_OPENCODE_SESSION_EVENT_KINDS = new Set([
  "agent.thinking",
  "agent.tool_call.start",
  "agent.tool_call.result",
  "agent.file.read",
  "agent.file.write",
  "agent.file.edit",
  "agent.bash.execute",
  "agent.bash.output",
  "agent.subagent.spawn",
  "agent.subagent.complete",
]);

const RENDERABLE_REPLAY_KINDS = [
  "agent.text",
  "agent.text.complete",
  "agent.thinking",
  "agent.tool_call.start",
  "agent.tool_call.result",
  "agent.file.read",
  "agent.file.write",
  "agent.file.edit",
  "agent.bash.execute",
  "agent.bash.output",
  "agent.subagent.spawn",
  "agent.subagent.complete",
  "agent.step",
  "agent.summary",
  "agent.question",
  "agent.permission.request",
  "session.idle",
  "session.awaiting_user",
  "session.error",
];

export const hasRichCanonicalOpenCodeEvents = (
  events: SessionEventProjection[],
): boolean => events.some((event) => RICH_OPENCODE_SESSION_EVENT_KINDS.has(event.kind));

export const shouldBackfillOpenCodeJob = (args: {
  nativeEventCount: number;
  existingSessionEvents: SessionEventProjection[];
}): boolean => args.nativeEventCount > 0 && !hasRichCanonicalOpenCodeEvents(args.existingSessionEvents);

const createReplayContext = (): OpenCodeReplayContext => ({
  partSnapshots: new Map(),
  partContentTypes: new Map(),
  toolUseBuffers: new Map(),
  activeTools: new Map(),
  emittedToolIds: new Set(),
  activeSubagentIds: new Set(),
});

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return null;
};

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

const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const FILE_WRITE_TOOLS = new Set(["Write"]);
const FILE_EDIT_TOOLS = new Set(["Edit"]);
const BASH_TOOLS = new Set(["Bash"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const PREVIEW_VALUE_ONLY_KEYS = new Set(["title", "description", "name", "prompt"]);

const normalizeToolName = (toolName: string): string =>
  TOOL_NAME_ALIASES[toolName.toLowerCase()] ?? toolName;

const normalizeContentType = (
  partType: string | undefined,
): "thinking" | "text" | "tool_use" | undefined => {
  if (!partType) return undefined;
  if (partType === "reasoning") return "thinking";
  if (partType === "tool") return "tool_use";
  if (partType === "text" || partType === "thinking" || partType === "tool_use") {
    return partType;
  }
  return undefined;
};

const resolvePartId = (props: Record<string, unknown>): string => {
  const partId = asString(props.partID) ?? asString(props.partId);
  if (partId) return partId;
  const messageId = asString(props.messageID) ?? asString(props.messageId) ?? "";
  const field = asString(props.field) ?? "text";
  return `${messageId}:${field}`;
};

const extractParam = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  key: string,
): string | undefined => {
  if (parsed) {
    const input = asRecord(parsed.input) ?? parsed;
    const value = input[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"));
  return match?.[1];
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

const detectBackground = (raw: string): boolean =>
  /(?:run_in_background|runInBackground)["\s]*[:=]\s*true/i.test(raw);

const extractInputPreview = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  toolName?: string,
): string | undefined => {
  const normalizedToolName = toolName ? normalizeToolName(toolName) : undefined;
  if (!parsed) {
    if (normalizedToolName && SUBAGENT_TOOLS.has(normalizedToolName)) return raw.slice(0, 300);
    return raw.slice(0, 100);
  }

  const input = asRecord(parsed.input);
  if (!input) return undefined;

  if (normalizedToolName && SUBAGENT_TOOLS.has(normalizedToolName)) {
    const parts: string[] = [];
    if (typeof input.subagent_type === "string") parts.push(`subagent_type: ${input.subagent_type}`);
    if (typeof input.description === "string") parts.push(`description: ${input.description.slice(0, 80)}`);
    if (parts.length > 0) return parts.join(" | ");
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0) {
      const preview = value.slice(0, 80);
      return PREVIEW_VALUE_ONLY_KEYS.has(key) ? preview : `${key}: ${preview}`;
    }
  }

  return undefined;
};

const emitToolSpecificEvents = (
  toolName: string,
  toolCallId: string,
  parsed: Record<string, unknown> | undefined,
  raw: string,
): CanonicalEvent[] => {
  const events: CanonicalEvent[] = [];
  const normalizedToolName = normalizeToolName(toolName);

  if (FILE_READ_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path", "pattern"]);
    if (filePath) {
      const offset = extractParamAny(parsed, raw, ["offset"]);
      const limit = extractParamAny(parsed, raw, ["limit"]);
      events.push({
        kind: "agent.file.read",
        toolCallId,
        filePath,
        ...(offset ? { lineRange: `${offset}-${limit ?? ""}` } : {}),
      });
    }
  } else if (FILE_WRITE_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
    if (filePath) events.push({ kind: "agent.file.write", toolCallId, filePath });
  } else if (FILE_EDIT_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
    if (filePath) events.push({ kind: "agent.file.edit", toolCallId, filePath });
  } else if (BASH_TOOLS.has(normalizedToolName)) {
    const command = extractParam(parsed, raw, "command");
    if (command) {
      events.push({
        kind: "agent.bash.execute",
        toolCallId,
        command,
        description: extractParam(parsed, raw, "description") ?? undefined,
      });
    }
  } else if (SUBAGENT_TOOLS.has(normalizedToolName)) {
    const description =
      extractParam(parsed, raw, "description") ??
      extractParam(parsed, raw, "prompt")?.slice(0, 200) ??
      normalizedToolName;
    const subagentType = extractParamAny(parsed, raw, ["subagent_type", "subagentType", "agent"]);
    events.push({
      kind: "agent.subagent.spawn",
      subagentId: toolCallId,
      description,
      isBackground: detectBackground(raw),
      subagentType,
    });
  }

  return events;
};

const completeSubagent = (
  context: OpenCodeReplayContext,
  subagentId: string,
  success: boolean,
): CanonicalEvent | null => {
  if (!context.activeSubagentIds.has(subagentId)) return null;
  context.activeSubagentIds.delete(subagentId);
  return { kind: "agent.subagent.complete", subagentId, success };
};

const handleToolPart = (
  partId: string,
  part: Record<string, unknown>,
  context: OpenCodeReplayContext,
): CanonicalEvent[] => {
  const events: CanonicalEvent[] = [];
  const toolName = normalizeToolName(asString(part.tool) ?? asString(part.name) ?? "unknown");
  const toolCallId = asString(part.callID) ?? asString(part.id) ?? partId;
  const state = asRecord(part.state);
  if (!state) return events;

  const status = asString(state.status);
  const input = asRecord(state.input) ?? context.activeTools.get(toolCallId)?.input;
  const rawInput = input ? JSON.stringify(input) : context.activeTools.get(toolCallId)?.rawInput ?? "";
  const parsed = input ? { input } : undefined;

  if (status === "pending" || status === "running") {
    const preview = extractInputPreview(parsed, rawInput, toolName);
    if (!context.emittedToolIds.has(toolCallId)) {
      events.push({
        kind: "agent.tool_call.start",
        toolName,
        toolCallId,
        inputPreview: preview,
      });
      context.emittedToolIds.add(toolCallId);
    }

    if (status === "running") {
      events.push(...emitToolSpecificEvents(toolName, toolCallId, parsed, rawInput));
      if (SUBAGENT_TOOLS.has(toolName)) context.activeSubagentIds.add(toolCallId);
    }

    context.activeTools.set(toolCallId, { toolName, input, rawInput });
    return events;
  }

  if (status === "completed" || status === "error") {
    if (!context.emittedToolIds.has(toolCallId)) {
      const preview = extractInputPreview(parsed, rawInput, toolName);
      events.push({ kind: "agent.tool_call.start", toolName, toolCallId, inputPreview: preview });
      events.push(...emitToolSpecificEvents(toolName, toolCallId, parsed, rawInput));
      if (SUBAGENT_TOOLS.has(toolName)) context.activeSubagentIds.add(toolCallId);
    }

    const output = asString(state.output) ?? asString(state.error);
    events.push({
      kind: "agent.tool_call.result",
      toolCallId,
      toolName,
      success: status === "completed",
      outputPreview: output?.slice(0, 200),
    });

    const subagentComplete = completeSubagent(context, toolCallId, status === "completed");
    if (subagentComplete) events.push(subagentComplete);

    context.activeTools.delete(toolCallId);
    context.emittedToolIds.delete(toolCallId);
  }

  return events;
};

const tryParseToolUse = (
  raw: string,
): { toolName: string; toolCallId: string; parsed: Record<string, unknown> } | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const parsedRecord = asRecord(parsed);
    if (!parsedRecord) return null;
    const toolName =
      asString(parsedRecord.name) ?? asString(parsedRecord.tool_name) ?? asString(parsedRecord.toolName);
    if (!toolName) return null;
    const toolCallId =
      asString(parsedRecord.id) ?? asString(parsedRecord.tool_call_id) ?? asString(parsedRecord.toolCallId) ?? `tool_${Date.now()}`;
    return { toolName: normalizeToolName(toolName), toolCallId, parsed: parsedRecord };
  } catch {
    return null;
  }
};

const mapOpenCodeToCanonical = (
  eventType: string,
  props: Record<string, unknown>,
  context: OpenCodeReplayContext,
): CanonicalEvent[] => {
  switch (eventType) {
    case "message.part.delta": {
      const rawDelta = asString(props.delta);
      if (!rawDelta) return [];

      const partId = resolvePartId(props);
      const contentType =
        normalizeContentType(asString(props.partType)) ??
        context.partContentTypes.get(partId) ??
        normalizeContentType(asString(props.field)) ??
        "text";

      if (contentType === "tool_use") {
        const existing = context.toolUseBuffers.get(partId) ?? "";
        const newContent = rawDelta.startsWith(existing) ? rawDelta.slice(existing.length) : rawDelta;
        const accumulated = existing + newContent;
        context.toolUseBuffers.set(partId, accumulated);
        const parsed = tryParseToolUse(accumulated);
        if (!parsed) return [];

        context.toolUseBuffers.delete(partId);
        const events: CanonicalEvent[] = [];
        if (!context.emittedToolIds.has(parsed.toolCallId)) {
          events.push({
            kind: "agent.tool_call.start",
            toolName: parsed.toolName,
            toolCallId: parsed.toolCallId,
            inputPreview: extractInputPreview(parsed.parsed, accumulated, parsed.toolName),
          });
          context.emittedToolIds.add(parsed.toolCallId);
        }
        events.push(...emitToolSpecificEvents(parsed.toolName, parsed.toolCallId, parsed.parsed, accumulated));
        context.activeTools.set(parsed.toolCallId, { toolName: parsed.toolName, rawInput: accumulated });
        if (SUBAGENT_TOOLS.has(parsed.toolName)) context.activeSubagentIds.add(parsed.toolCallId);
        return events;
      }

      const previous = context.partSnapshots.get(partId) ?? "";
      if (rawDelta.startsWith(previous)) {
        const incrementalDelta = rawDelta.slice(previous.length);
        context.partSnapshots.set(partId, rawDelta);
        if (incrementalDelta.length === 0) return [];
        return [{ kind: contentType === "thinking" ? "agent.thinking" : "agent.text", content: incrementalDelta }];
      }

      context.partSnapshots.set(partId, rawDelta);
      return contentType === "thinking"
        ? [{ kind: "agent.thinking", content: rawDelta }]
        : [{ kind: "agent.text.complete", fullText: rawDelta }];
    }

    case "message.part.updated": {
      const part = asRecord(props.part);
      if (!part) return [];
      const partId = resolvePartId(props);
      const partType = asString(part.type) ?? asString(props.partType);
      const contentType = normalizeContentType(partType);
      if (contentType) context.partContentTypes.set(partId, contentType);

      if (partType === "text") {
        const text = asString(part.text);
        if (!text) return [];
        context.partSnapshots.set(partId, text);
        return [{ kind: "agent.text.complete", fullText: text }];
      }
      if (partType === "reasoning") {
        const text = asString(part.text);
        if (text) context.partSnapshots.set(partId, text);
        return [];
      }
      if (partType === "tool") return handleToolPart(partId, part, context);
      if (partType === "agent" || partType === "subtask") {
        const subagentId = partId;
        context.activeSubagentIds.add(subagentId);
        return [{
          kind: "agent.subagent.spawn",
          subagentId,
          description: asString(part.name) ?? asString(part.description) ?? asString(part.prompt) ?? "agent",
          isBackground: false,
          subagentType: asString(part.source) ?? asString(part.agent),
        }];
      }
      if (partType === "step-start") return [{ kind: "agent.step", description: "LLM step started" }];
      if (partType === "step-finish") {
        const reason = asString(part.reason) ?? "completed";
        return [{ kind: "agent.step", description: `Step finished: ${reason}` }];
      }
      if (partType === "file") {
        const filePath = asString(part.url) ?? asString(part.filename) ?? "unknown";
        return [{ kind: "agent.file.read", toolCallId: `file-${partId}`, filePath }];
      }
      if (partType === "patch") {
        const files = Array.isArray(part.files) ? part.files : [];
        return files.map((file) => ({
          kind: "agent.file.edit",
          toolCallId: `patch-${partId}`,
          filePath: typeof file === "string" ? file : asString(asRecord(file)?.path) ?? asString(asRecord(file)?.name) ?? "unknown",
        }));
      }
      if (partType === "retry") {
        const attempt = typeof part.attempt === "number" ? part.attempt : 0;
        const error = asRecord(part.error);
        return [{ kind: "agent.step", description: `Retry attempt ${attempt}: ${asString(error?.message) ?? "API error"}` }];
      }
      if (partType === "compaction") return [{ kind: "agent.step", description: "Context compaction performed" }];
      return [];
    }

    case "session.idle":
    case "session.status": {
      if (eventType === "session.status" && asString(props.type) !== "idle") return [];
      const events: CanonicalEvent[] = [];
      for (const [toolCallId, info] of context.activeTools) {
        events.push({ kind: "agent.tool_call.result", toolCallId, toolName: info.toolName, success: true });
      }
      context.activeTools.clear();
      for (const subagentId of context.activeSubagentIds) {
        events.push({ kind: "agent.subagent.complete", subagentId, success: true });
      }
      context.activeSubagentIds.clear();
      context.partSnapshots.clear();
      context.partContentTypes.clear();
      context.toolUseBuffers.clear();
      context.emittedToolIds.clear();
      events.push({ kind: "session.idle", hasBackgroundAgents: false, isPlanningJob: false });
      return events;
    }

    case "question.asked": {
      return [{ kind: "agent.question", questionText: asString(props.text) ?? asString(props.question) ?? "Input required" }];
    }

    case "permission.asked": {
      const toolName = asString(props.tool) ?? asString(props.toolName) ?? "unknown";
      return [{ kind: "agent.permission.request", toolName, description: asString(props.description) }];
    }

    case "session.error": {
      return [{ kind: "session.error", message: asString(props.message) ?? asString(props.error) ?? "OpenCode error", recoverable: false }];
    }

    case "file.edited": {
      const file = asString(props.file);
      return file ? [{ kind: "agent.file.edit", toolCallId: `file-edit-${Date.now()}`, filePath: file }] : [];
    }

    default:
      return [];
  }
};

const extractOpenCodeProperties = (payload: Record<string, unknown>): Record<string, unknown> => {
  const properties = asRecord(payload.properties);
  if (properties) return properties;

  const data = asRecord(payload.data);
  const nestedProperties = data ? asRecord(data.properties) : undefined;
  if (nestedProperties) return nestedProperties;

  return payload;
};

const eventContent = (event: CanonicalEvent): string | null => {
  if (event.kind === "agent.text" || event.kind === "agent.thinking") {
    return asString(event.content) ?? null;
  }
  if (event.kind === "agent.text.complete") {
    return asString(event.fullText) ?? null;
  }
  return null;
};

const mergeMetadata = (
  payload: Record<string, unknown>,
  row: OpenCodeNativeEventRow,
): Record<string, unknown> => {
  const props = extractOpenCodeProperties(row.payload);
  const existingMetadata = asRecord(payload.metadata) ?? {};
  return {
    ...payload,
    metadata: {
      ...existingMetadata,
      source: "opencode-native-backfill",
      nativeSequenceNum: row.sequenceNum,
      runtimeSessionId:
        row.runtimeSessionId ?? asString(props.sessionID) ?? asString(props.sessionId) ?? undefined,
    },
  };
};

const canonicalToPayload = (event: CanonicalEvent): Record<string, unknown> => {
  const { kind: _kind, ...payload } = event;
  if (event.kind === "agent.text.complete") {
    return { content: asString(event.fullText) ?? "" };
  }
  return payload;
};

const coalesceReplayEvents = (
  events: RowBackedCanonicalEvent[],
): RowBackedCanonicalEvent[] => {
  const result: RowBackedCanonicalEvent[] = [];
  let buffered: RowBackedCanonicalEvent | null = null;
  let bufferKind: "agent.text" | "agent.thinking" | null = null;
  let bufferContent = "";

  const flush = () => {
    if (!buffered || !bufferKind) return;
    result.push({
      ...buffered,
      event: { kind: bufferKind, content: bufferContent },
    });
    buffered = null;
    bufferKind = null;
    bufferContent = "";
  };

  for (const item of events) {
    const kind = item.event.kind === "agent.text.complete" ? "agent.text" : item.event.kind;
    if (kind === "agent.text" || kind === "agent.thinking") {
      const content = eventContent(item.event);
      if (!content) continue;
      if (bufferKind === kind) {
        bufferContent = item.event.kind === "agent.text.complete" ? content : bufferContent + content;
        continue;
      }
      flush();
      buffered = item;
      bufferKind = kind;
      bufferContent = content;
      continue;
    }

    flush();
    result.push(item);
  }

  flush();
  return result;
};

export const buildOpenCodeBackfilledSessionEvents = (
  nativeRows: OpenCodeNativeEventRow[],
): BackfilledSessionEvent[] => {
  const context = createReplayContext();
  const rawEvents: RowBackedCanonicalEvent[] = [];

  for (const row of [...nativeRows].sort((a, b) => a.sequenceNum - b.sequenceNum)) {
    const props = extractOpenCodeProperties(row.payload);
    const canonicalEvents = mapOpenCodeToCanonical(row.nativeEventType, props, context);
    for (const event of canonicalEvents) {
      rawEvents.push({ event, sourceRow: row });
    }
  }

  return coalesceReplayEvents(rawEvents).map((item, index) => {
    const payload = mergeMetadata(canonicalToPayload(item.event), item.sourceRow);
    return {
      agentJobId: item.sourceRow.agentJobId,
      planningSessionId: item.sourceRow.planningSessionId,
      sequenceNum: index + 1,
      kind: item.event.kind === "agent.text.complete" ? "agent.text" : item.event.kind,
      payload,
      provider: item.sourceRow.provider,
      createdAt: toDate(item.sourceRow.emittedAt) ?? toDate(item.sourceRow.receivedAt) ?? new Date(),
    };
  });
};

type OpenCodeCandidateRow = {
  agent_job_id: string;
  native_event_count: number;
};

type NativeEventDbRow = {
  agent_job_id: string;
  planning_session_id: string | null;
  sequence_num: number;
  native_event_type: string;
  provider: string | null;
  coding_agent: string | null;
  runtime_session_id: string | null;
  payload: Record<string, unknown>;
  emitted_at: Date | null;
  received_at: Date;
};

type ExistingSessionEventRow = {
  kind: string;
  payload: Record<string, unknown>;
};

const toNativeRow = (row: NativeEventDbRow): OpenCodeNativeEventRow => ({
  agentJobId: row.agent_job_id,
  planningSessionId: row.planning_session_id,
  sequenceNum: row.sequence_num,
  nativeEventType: row.native_event_type,
  provider: row.provider,
  codingAgent: row.coding_agent,
  runtimeSessionId: row.runtime_session_id,
  payload: row.payload,
  emittedAt: row.emitted_at,
  receivedAt: row.received_at,
});

const findOpenCodeCandidateJobs = async (sql: Sql): Promise<OpenCodeCandidateRow[]> =>
  sql<OpenCodeCandidateRow[]>`
    SELECT
      aj.id AS agent_job_id,
      count(ane.id)::int AS native_event_count
    FROM agent_jobs aj
    JOIN agent_native_events ane ON ane.agent_job_id = aj.id
    WHERE aj.coding_agent = 'opencode'
       OR ane.coding_agent = 'opencode'
    GROUP BY aj.id
    ORDER BY min(ane.received_at) ASC
  `;

const readExistingSessionEvents = async (
  sql: Sql,
  agentJobId: string,
): Promise<ExistingSessionEventRow[]> =>
  sql<ExistingSessionEventRow[]>`
    SELECT kind, payload
    FROM session_events
    WHERE agent_job_id = ${agentJobId}
    ORDER BY sequence_num ASC
  `;

const readNativeEvents = async (
  sql: Sql,
  agentJobId: string,
): Promise<OpenCodeNativeEventRow[]> => {
  const rows = await sql<NativeEventDbRow[]>`
    SELECT
      agent_job_id,
      planning_session_id,
      sequence_num,
      native_event_type,
      provider,
      coding_agent,
      runtime_session_id,
      payload,
      emitted_at,
      received_at
    FROM agent_native_events
    WHERE agent_job_id = ${agentJobId}
      AND (coding_agent = 'opencode' OR source_format = 'opencode-sse')
    ORDER BY sequence_num ASC
  `;
  return rows.map(toNativeRow);
};

const replaceRenderableSessionEvents = async (
  sql: Sql,
  agentJobId: string,
  events: BackfilledSessionEvent[],
): Promise<void> => {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `DELETE FROM session_events
       WHERE agent_job_id = $1
         AND kind = ANY($2::text[])`,
      [agentJobId, RENDERABLE_REPLAY_KINDS],
    );

    for (const event of events) {
      await tx.unsafe(
        `INSERT INTO session_events (
           agent_job_id,
           planning_session_id,
           sequence_num,
           kind,
           payload,
           provider,
           created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          event.agentJobId,
          event.planningSessionId,
          event.sequenceNum,
          event.kind,
          JSON.stringify(event.payload),
          event.provider,
          event.createdAt,
        ],
      );
    }
  });
};

export const createOpenCodeSessionEventsBackfill = (sql: Sql): DataBackfillDefinition => ({
  key: OPENCODE_SESSION_EVENTS_BACKFILL_KEY,
  description: "Replay historical OpenCode native events into rich canonical session_events",
  checksum: OPENCODE_SESSION_EVENTS_BACKFILL_CHECKSUM,
  fatalOnFailure: false,
  run: async (context) => {
    const candidates = await findOpenCodeCandidateJobs(sql);
    let jobsBackfilled = 0;
    let jobsSkipped = 0;
    let eventsInserted = 0;

    for (const candidate of candidates) {
      const existingSessionEvents = await readExistingSessionEvents(sql, candidate.agent_job_id);
      if (!shouldBackfillOpenCodeJob({
        nativeEventCount: candidate.native_event_count,
        existingSessionEvents,
      })) {
        jobsSkipped += 1;
        continue;
      }

      const nativeEvents = await readNativeEvents(sql, candidate.agent_job_id);
      const rebuiltEvents = buildOpenCodeBackfilledSessionEvents(nativeEvents);
      if (rebuiltEvents.length === 0) {
        jobsSkipped += 1;
        continue;
      }

      await replaceRenderableSessionEvents(sql, candidate.agent_job_id, rebuiltEvents);
      jobsBackfilled += 1;
      eventsInserted += rebuiltEvents.length;
      context.log("info", "Backfilled OpenCode session events", {
        agentJobId: candidate.agent_job_id,
        eventsInserted: rebuiltEvents.length,
      });
    }

    return {
      processedCount: jobsBackfilled,
      metadata: {
        candidates: candidates.length,
        jobsBackfilled,
        jobsSkipped,
        eventsInserted,
      },
    };
  },
});
