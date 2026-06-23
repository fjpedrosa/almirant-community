import type { CanonicalEvent } from "@almirant/stream-consumer";

export const PLANNING_BOOTSTRAP_PROJECTOR_VERSION = 2;

export type PlanningBootstrapMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  messageType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
};

export type PlanningBootstrapStreamingBlock =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      toolName: string;
      toolCallId: string;
      status: "pending" | "success" | "error";
      inputPreview?: string;
      filePath?: string;
      lineRange?: string;
      command?: string;
      description?: string;
    }
  | { type: "file_read"; filePath: string; lineRange?: string }
  | { type: "file_change"; filePath: string; operation: "write" | "edit" }
  | {
      type: "bash";
      command: string;
      description?: string;
    }
  | {
      type: "subagent";
      subagentId: string;
      description: string;
      isBackground: boolean;
      status: "running" | "done";
      subagentType?: string;
    };

export type PlanningBootstrapWaveInfo = {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    done?: boolean;
    success?: boolean;
  }>;
  successCount: number;
  totalCount: number;
} | null;

export type PlanningBootstrapPendingQuestion = {
  questionId: string;
  questionText: string;
  options: string[];
  questions?: Array<{
    text: string;
    options: string[];
  }>;
  questionType?: "single_choice" | "multi_choice" | "free_text";
} | null;

export type PlanningBootstrapState = {
  messages: PlanningBootstrapMessage[];
  streamingBlocks: PlanningBootstrapStreamingBlock[];
  pendingQuestion: PlanningBootstrapPendingQuestion;
  currentStep: { name: string; index: number } | null;
  latestActivity: string | null;
  tokenUsage: { input: number; output: number; model?: string };
  waveInfo: PlanningBootstrapWaveInfo;
  pendingFollowUp: boolean;
  followUpPrompt: string | null;
};

export type PlanningBootstrapEventRecord = {
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown> | null;
  createdAt: Date | string;
};

export type PlanningBootstrapUserInput = {
  jobId: string;
  message: string;
  payload: Record<string, unknown> | null;
  timestamp: Date | string;
};

type TimedStreamingBlock = PlanningBootstrapStreamingBlock & {
  createdAt: string;
};

type InternalWaveAgent = {
  id: string;
  name: string;
  role: string;
  done?: boolean;
  success?: boolean;
};

type InternalState = {
  messageIndex: number;
  stepIndex: number;
  messages: PlanningBootstrapMessage[];
  streamingBlocks: TimedStreamingBlock[];
  pendingQuestion: PlanningBootstrapPendingQuestion;
  currentStep: { name: string; index: number } | null;
  latestActivity: string | null;
  tokenUsage: { input: number; output: number; model?: string };
  waveInfo: {
    agents: InternalWaveAgent[];
    successCount: number;
    totalCount: number;
  } | null;
  pendingFollowUp: boolean;
  followUpPrompt: string | null;
};

export type PlanningBootstrapSerializedState = {
  messageIndex: number;
  stepIndex: number;
  messages: PlanningBootstrapMessage[];
  streamingBlocks: TimedStreamingBlock[];
  pendingQuestion: PlanningBootstrapPendingQuestion;
  currentStep: { name: string; index: number } | null;
  latestActivity: string | null;
  tokenUsage: { input: number; output: number; model?: string };
  waveInfo: {
    agents: InternalWaveAgent[];
    successCount: number;
    totalCount: number;
  } | null;
  pendingFollowUp: boolean;
  followUpPrompt: string | null;
};

export type PlanningBootstrapProjection = {
  baseState: PlanningBootstrapState;
  baseSeq: number;
  checkpointState: PlanningBootstrapSerializedState;
};

type BootstrapTimelineEntry =
  | {
      type: "event";
      createdAt: string;
      sortTime: number;
      sequenceNum: number;
      event: CanonicalEvent;
    }
  | {
      type: "user_input";
      createdAt: string;
      sortTime: number;
      index: number;
      message: string;
      payload: Record<string, unknown>;
    };

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const toSortTime = (value: Date | string): number => {
  const iso = toIsoString(value);
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const GENERIC_MCP_TOOL_NAMES = new Set(["mcp_tool", "MCP tool"]);

const nextMessageId = (state: InternalState): string => {
  state.messageIndex += 1;
  return `bootstrap-${state.messageIndex}`;
};

const pushMessage = (
  state: InternalState,
  sessionId: string,
  message: Omit<PlanningBootstrapMessage, "id" | "sessionId">,
): void => {
  state.messages.push({
    id: nextMessageId(state),
    sessionId,
    ...message,
  });
};

const flushStreamingBlocks = (
  state: InternalState,
  sessionId: string,
): void => {
  if (state.streamingBlocks.length === 0) return;

  for (const block of state.streamingBlocks) {
    switch (block.type) {
      case "thinking":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: block.content,
          messageType: "thinking",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: block.createdAt,
        });
        break;
      case "text":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: block.content,
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: block.createdAt,
        });
        break;
      case "tool_call":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: "",
          messageType: "tool_call",
          inputTokens: null,
          outputTokens: null,
          metadata: {
            toolName: block.toolName,
            toolCallId: block.toolCallId,
            inputPreview: block.inputPreview,
            filePath: block.filePath,
            lineRange: block.lineRange,
            command: block.command,
            description: block.description,
            status: block.status,
          },
          createdAt: block.createdAt,
        });
        break;
      case "subagent":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: "",
          messageType: "subagent",
          inputTokens: null,
          outputTokens: null,
          metadata: {
            subagentId: block.subagentId,
            description: block.description,
            isBackground: block.isBackground,
            status: block.status,
            subagentType: block.subagentType,
          },
          createdAt: block.createdAt,
        });
        break;
      case "file_read":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: "",
          messageType: "tool_call",
          inputTokens: null,
          outputTokens: null,
          metadata: {
            toolName: "Read",
            toolCallId: nextMessageId(state),
            inputPreview: block.filePath,
            lineRange: block.lineRange,
          },
          createdAt: block.createdAt,
        });
        break;
      case "file_change":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: "",
          messageType: "tool_call",
          inputTokens: null,
          outputTokens: null,
          metadata: {
            toolName: block.operation === "write" ? "Write" : "Edit",
            toolCallId: nextMessageId(state),
            inputPreview: block.filePath,
          },
          createdAt: block.createdAt,
        });
        break;
      case "bash":
        pushMessage(state, sessionId, {
          role: "assistant",
          content: "",
          messageType: "tool_call",
          inputTokens: null,
          outputTokens: null,
          metadata: {
            toolName: "Bash",
            toolCallId: nextMessageId(state),
            inputPreview: block.command,
            description: block.description,
          },
          createdAt: block.createdAt,
        });
        break;
    }
  }

  state.streamingBlocks = [];
  state.latestActivity = null;
};

const shortText = (value: string, max = 60): string =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const toNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const extractJsonRecord = (
  value: string | undefined,
): Record<string, unknown> | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
};

const buildMcpToolName = (
  server: string | undefined,
  action: string | undefined,
): string | null => {
  if (!server || !action) return null;
  if (action.startsWith("mcp__")) return action;
  const normalizedServer = server.replace(/^mcp__/, "").trim();
  const normalizedAction = action.replace(/^__+/, "").trim();
  if (!normalizedServer || !normalizedAction) return null;
  return `mcp__${normalizedServer}__${normalizedAction}`;
};

const normalizePlanningToolName = (
  toolName: string,
  preview?: string,
): string => {
  if (toolName.startsWith("mcp__")) return toolName;
  if (!GENERIC_MCP_TOOL_NAMES.has(toolName)) return toolName;

  const parsed = extractJsonRecord(preview);
  if (parsed) {
    const explicitName =
      toNonEmptyString(parsed.name) ??
      toNonEmptyString(parsed.toolName) ??
      toNonEmptyString(parsed.tool_name);
    if (explicitName?.startsWith("mcp__")) return explicitName;

    const nestedInput = isRecord(parsed.input)
      ? parsed.input
      : isRecord(parsed.arguments)
        ? parsed.arguments
        : isRecord(parsed.params)
          ? parsed.params
          : null;
    const source = nestedInput ?? parsed;
    const normalized = buildMcpToolName(
      toNonEmptyString(source.server) ??
        toNonEmptyString(source.serverName) ??
        toNonEmptyString(source.server_name),
      toNonEmptyString(source.tool) ??
        toNonEmptyString(source.toolName) ??
        toNonEmptyString(source.tool_name) ??
        toNonEmptyString(source.name),
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

  return buildMcpToolName(serverMatch?.[1], toolMatch?.[1]) ?? toolName;
};

const humanizeToolActivity = (toolName: string, inputPreview?: string): string => {
  if (toolName === "Agent" || toolName === "Task" || toolName === "AskUserQuestion") return "";

  const toolLabels: Record<string, string> = {
    Read: "Reading",
    Write: "Writing",
    Edit: "Editing",
    Glob: "Searching files",
    Grep: "Searching code",
    Bash: "Running command",
    Skill: "Loading skill",
    ToolSearch: "Searching tool",
    WebSearch: "Searching web",
    WebFetch: "Fetching web",
    NotebookEdit: "Editing notebook",
    LSP: "Analyzing code",
  };

  const label = toolLabels[toolName] ?? "Using tool";
  if (!inputPreview) return label;

  let detail = inputPreview;

  if (detail.startsWith("{")) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>;
      const input = isRecord(parsed.input) ? parsed.input : parsed;
      detail =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.pattern === "string" && input.pattern) ||
        (typeof input.command === "string" && input.command) ||
        (typeof input.query === "string" && input.query) ||
        (typeof input.description === "string" && input.description) ||
        (typeof input.url === "string" && input.url) ||
        "";
    } catch {
      detail = detail;
    }
  }

  detail = detail.replace(/\/workspace\/repo\//g, "");
  const colonIdx = detail.indexOf(": ");
  if (colonIdx > 0 && colonIdx < 20) {
    detail = detail.slice(colonIdx + 2);
  }

  return detail ? `${label} ${shortText(detail)}` : label;
};

const parseSubagentPreview = (
  inputPreview?: string,
): { description?: string; subagentType?: string } => {
  if (!inputPreview) return {};

  const typeMatch = inputPreview.match(/subagent_type[":.\s]+([a-zA-Z_-]+)/);
  const descMatch = inputPreview.match(/description[":.\s]+([^"}\n]+)/);

  return {
    subagentType: typeMatch?.[1],
    description: descMatch?.[1]?.trim(),
  };
};

const toCanonicalEvent = (record: PlanningBootstrapEventRecord): CanonicalEvent => {
  const payload = isRecord(record.payload) ? record.payload : {};
  return {
    ...payload,
    kind: record.kind,
  } as CanonicalEvent;
};

const toPublicStreamingBlocks = (
  blocks: TimedStreamingBlock[],
): PlanningBootstrapStreamingBlock[] =>
  blocks.map(({ createdAt: _createdAt, ...block }) => block);

const createInitialState = (): InternalState => ({
  messageIndex: 0,
  stepIndex: 0,
  messages: [],
  streamingBlocks: [],
  pendingQuestion: null,
  currentStep: null,
  latestActivity: null,
  tokenUsage: { input: 0, output: 0 },
  waveInfo: null,
  pendingFollowUp: false,
  followUpPrompt: null,
});

const toPublicState = (state: InternalState): PlanningBootstrapState => ({
  messages: state.messages,
  streamingBlocks: toPublicStreamingBlocks(state.streamingBlocks),
  pendingQuestion: state.pendingQuestion,
  currentStep: state.currentStep,
  latestActivity: state.latestActivity,
  tokenUsage: state.tokenUsage,
  waveInfo: state.waveInfo,
  pendingFollowUp: state.pendingFollowUp,
  followUpPrompt: state.followUpPrompt,
});

export const materializePlanningBootstrapState = (
  state: PlanningBootstrapSerializedState,
): PlanningBootstrapState => toPublicState(rehydratePlanningBootstrapState(state));

const serializeState = (
  state: InternalState,
): PlanningBootstrapSerializedState => ({
  messageIndex: state.messageIndex,
  stepIndex: state.stepIndex,
  messages: state.messages.map((message) => ({
    ...message,
    metadata: isRecord(message.metadata) ? { ...message.metadata } : {},
  })),
  streamingBlocks: state.streamingBlocks.map((block) => ({ ...block })),
  pendingQuestion: state.pendingQuestion ? { ...state.pendingQuestion } : null,
  currentStep: state.currentStep ? { ...state.currentStep } : null,
  latestActivity: state.latestActivity,
  tokenUsage: { ...state.tokenUsage },
  waveInfo: state.waveInfo
    ? {
        ...state.waveInfo,
        agents: state.waveInfo.agents.map((agent) => ({ ...agent })),
      }
    : null,
  pendingFollowUp: state.pendingFollowUp,
  followUpPrompt: state.followUpPrompt,
});

export const rehydratePlanningBootstrapState = (
  state: PlanningBootstrapSerializedState,
): InternalState => ({
  messageIndex: state.messageIndex,
  stepIndex: state.stepIndex,
  messages: state.messages.map((message) => ({
    ...message,
    metadata: isRecord(message.metadata) ? { ...message.metadata } : {},
  })),
  streamingBlocks: state.streamingBlocks.map((block) => ({ ...block })),
  pendingQuestion: state.pendingQuestion ? { ...state.pendingQuestion } : null,
  currentStep: state.currentStep ? { ...state.currentStep } : null,
  latestActivity: state.latestActivity,
  tokenUsage: { ...state.tokenUsage },
  waveInfo: state.waveInfo
    ? {
        ...state.waveInfo,
        agents: state.waveInfo.agents.map((agent) => ({ ...agent })),
      }
    : null,
  pendingFollowUp: state.pendingFollowUp,
  followUpPrompt: state.followUpPrompt,
});

const buildTimelineEntries = ({
  events,
  userInputs,
}: {
  events: PlanningBootstrapEventRecord[];
  userInputs: PlanningBootstrapUserInput[];
}): BootstrapTimelineEntry[] =>
  [
    ...events.map((record) => ({
      type: "event" as const,
      createdAt: toIsoString(record.createdAt),
      sortTime: toSortTime(record.createdAt),
      sequenceNum: record.sequenceNum,
      event: toCanonicalEvent(record),
    })),
    ...userInputs.map((entry, index) => ({
      type: "user_input" as const,
      createdAt: toIsoString(entry.timestamp),
      sortTime: toSortTime(entry.timestamp),
      index,
      message: entry.message,
      payload: isRecord(entry.payload) ? entry.payload : {},
    })),
  ].sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    if (a.type !== b.type) return a.type === "user_input" ? -1 : 1;
    if (a.type === "event" && b.type === "event") return a.sequenceNum - b.sequenceNum;
    if (a.type === "user_input" && b.type === "user_input") return a.index - b.index;
    return 0;
  });

const applyTimelineEntries = ({
  state,
  sessionId,
  timelineEntries,
}: {
  state: InternalState;
  sessionId: string;
  timelineEntries: BootstrapTimelineEntry[];
}): void => {
  for (const entry of timelineEntries) {
    if (entry.type === "user_input") {
      if (state.streamingBlocks.length > 0) {
        flushStreamingBlocks(state, sessionId);
      }

      state.pendingQuestion = null;
      state.pendingFollowUp = false;
      state.followUpPrompt = null;

      pushMessage(state, sessionId, {
        role: "user",
        content: entry.message,
        messageType: "user",
        inputTokens: null,
        outputTokens: null,
        metadata: entry.payload,
        createdAt: entry.createdAt,
        deliveryStatus: "delivered",
      });
      continue;
    }

    const { event } = entry;

    switch (event.kind) {
      case "agent.text": {
        const lastBlock = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (lastBlock?.type === "text") {
          lastBlock.content += event.content;
        } else {
          state.streamingBlocks.push({
            type: "text",
            content: event.content,
            createdAt: entry.createdAt,
          });
        }
        break;
      }

      case "agent.thinking": {
        const lastBlock = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (lastBlock?.type === "thinking") {
          lastBlock.content += event.content;
        } else {
          state.streamingBlocks.push({
            type: "thinking",
            content: event.content,
            createdAt: entry.createdAt,
          });
        }
        break;
      }

      case "agent.tool_call.start": {
        const normalizedToolName = normalizePlanningToolName(
          event.toolName,
          event.inputPreview,
        );
        if (normalizedToolName === "AskUserQuestion") break;

        if (normalizedToolName === "Agent" || normalizedToolName === "Task") {
          const parsed = parseSubagentPreview(event.inputPreview);
          const existing = state.streamingBlocks.find(
            (block) =>
              block.type === "subagent" && block.subagentId === event.toolCallId,
          );
          if (!existing) {
            state.streamingBlocks.push({
              type: "subagent",
              subagentId: event.toolCallId,
              description:
                parsed.description ?? parsed.subagentType ?? "Subagent",
              isBackground: false,
              status: "running",
              subagentType: parsed.subagentType,
              createdAt: entry.createdAt,
            });
          } else if (existing.type === "subagent") {
            if (parsed.description && existing.description === "Subagent") {
              existing.description = parsed.description;
            }
            if (parsed.subagentType && !existing.subagentType) {
              existing.subagentType = parsed.subagentType;
            }
          }
          state.latestActivity = `Agente: ${shortText(
            parsed.description ?? parsed.subagentType ?? normalizedToolName,
            50,
          )}`;
          break;
        }

        const existing = state.streamingBlocks.find(
          (block) =>
            (block.type === "tool_call" &&
              block.toolCallId === event.toolCallId) ||
            (block.type === "subagent" &&
              block.subagentId === event.toolCallId),
        );

        if (existing && existing.type === "tool_call") {
          if (event.inputPreview && event.inputPreview.length > 0) {
            existing.inputPreview = event.inputPreview;
          }
        } else if (!existing) {
          state.streamingBlocks.push({
            type: "tool_call",
            toolName: normalizedToolName,
            toolCallId: event.toolCallId,
            status: "pending",
            inputPreview: event.inputPreview,
            createdAt: entry.createdAt,
          });
        }

        state.latestActivity =
          humanizeToolActivity(normalizedToolName, event.inputPreview) ||
          state.latestActivity;
        break;
      }

      case "agent.tool_call.result": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "tool_call" && block.toolCallId === event.toolCallId,
        );

        if (existing && existing.type === "tool_call") {
          existing.status = event.success ? "success" : "error";
        }
        break;
      }

      case "agent.file.read": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "tool_call" && block.toolCallId === event.toolCallId,
        );

        if (existing && existing.type === "tool_call") {
          existing.filePath = event.filePath;
          existing.lineRange = event.lineRange;
        } else {
          state.streamingBlocks.push({
            type: "file_read",
            filePath: event.filePath,
            lineRange: event.lineRange,
            createdAt: entry.createdAt,
          });
        }

        state.latestActivity = `Reading ${shortText(event.filePath.replace(/\/workspace\/repo\//g, ""))}`;
        break;
      }

      case "agent.file.write":
      case "agent.file.edit": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "tool_call" && block.toolCallId === event.toolCallId,
        );

        if (existing && existing.type === "tool_call") {
          existing.filePath = event.filePath;
        } else {
          state.streamingBlocks.push({
            type: "file_change",
            filePath: event.filePath,
            operation: event.kind === "agent.file.write" ? "write" : "edit",
            createdAt: entry.createdAt,
          });
        }
        break;
      }

      case "agent.bash.execute": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "tool_call" && block.toolCallId === event.toolCallId,
        );

        if (existing && existing.type === "tool_call") {
          existing.command = event.command;
          existing.description = event.description;
        } else {
          state.streamingBlocks.push({
            type: "bash",
            command: event.command,
            description: event.description,
            createdAt: entry.createdAt,
          });
        }

        state.latestActivity = `Running ${shortText(event.command, 50)}`;
        break;
      }

      case "agent.subagent.spawn": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "subagent" && block.subagentId === event.subagentId,
        );

        if (existing && existing.type === "subagent") {
          existing.description = event.description || existing.description;
          existing.subagentType = event.subagentType || existing.subagentType;
        } else {
          state.streamingBlocks.push({
            type: "subagent",
            subagentId: event.subagentId,
            description: event.description,
            isBackground: event.isBackground,
            status: "running",
            subagentType: event.subagentType,
            createdAt: entry.createdAt,
          });
        }

        state.latestActivity = `Agente: ${shortText(event.description, 50)}`;
        break;
      }

      case "agent.subagent.complete": {
        const existing = state.streamingBlocks.find(
          (block) =>
            block.type === "subagent" && block.subagentId === event.subagentId,
        );

        if (existing && existing.type === "subagent") {
          existing.status = "done";
        }
        break;
      }

      case "agent.wave.start":
        state.waveInfo = {
          agents: event.agents.map((agent) => ({
            id: agent.agent,
            name: agent.agent,
            role: agent.title,
            done: false,
            success: undefined,
          })),
          successCount: 0,
          totalCount: event.agents.length,
        };
        break;

      case "agent.wave.agent_done":
        if (state.waveInfo) {
          state.waveInfo.agents = state.waveInfo.agents.map((agent) =>
            agent.id === event.agent
              ? { ...agent, done: true, success: event.success }
              : agent,
          );
        }
        break;

      case "agent.wave.end":
        if (state.waveInfo) {
          state.waveInfo.successCount = event.successCount;
          state.waveInfo.totalCount = event.totalCount;
        }
        break;

      case "agent.question":
        flushStreamingBlocks(state, sessionId);
        state.pendingQuestion = {
          questionId: `question-${entry.sequenceNum}`,
          questionText: event.questionText,
          options: event.options ?? [],
          ...(event.questions ? { questions: event.questions } : {}),
          questionType: event.questionType,
        };
        state.pendingFollowUp = false;
        state.followUpPrompt = null;
        state.currentStep = null;
        break;

      case "session.awaiting_user":
        flushStreamingBlocks(state, sessionId);
        state.pendingQuestion = null;
        state.pendingFollowUp = true;
        state.followUpPrompt = event.prompt;
        state.currentStep = null;
        break;

      case "agent.step":
        state.stepIndex += 1;
        state.currentStep = {
          name: event.description,
          index: state.stepIndex,
        };
        break;

      case "session.idle":
        flushStreamingBlocks(state, sessionId);
        state.currentStep = null;
        break;

      case "job.completed":
      case "job.failed":
      case "job.cancelled":
      case "job.timeout":
      case "session.error":
        flushStreamingBlocks(state, sessionId);
        state.currentStep = null;
        break;

      case "agent.text.complete":
      case "agent.bash.output":
      case "agent.permission.request":
      case "session.connected":
      case "session.closed":
      case "job.started":
      case "heartbeat":
      case "system.info":
      case "system.warn":
      case "message.queued":
      case "message.dequeued":
        break;
    }
  }
};

const getMaxSequence = (events: PlanningBootstrapEventRecord[], fallback = 0): number =>
  events.reduce(
    (max, event) => Math.max(max, event.sequenceNum),
    fallback,
  );

export const buildPlanningSessionBootstrap = ({
  sessionId,
  events,
  userInputs,
}: {
  sessionId: string;
  events: PlanningBootstrapEventRecord[];
  userInputs: PlanningBootstrapUserInput[];
}): PlanningBootstrapProjection => {
  const state = createInitialState();
  applyTimelineEntries({
    state,
    sessionId,
    timelineEntries: buildTimelineEntries({ events, userInputs }),
  });

  const baseSeq = getMaxSequence(events);

  return {
    baseSeq,
    baseState: toPublicState(state),
    checkpointState: serializeState(state),
  };
};

export const continuePlanningSessionBootstrap = ({
  sessionId,
  checkpointState,
  checkpointSeq,
  events,
  userInputs,
}: {
  sessionId: string;
  checkpointState: PlanningBootstrapSerializedState;
  checkpointSeq: number;
  events: PlanningBootstrapEventRecord[];
  userInputs: PlanningBootstrapUserInput[];
}): PlanningBootstrapProjection => {
  const state = rehydratePlanningBootstrapState(checkpointState);
  applyTimelineEntries({
    state,
    sessionId,
    timelineEntries: buildTimelineEntries({ events, userInputs }),
  });

  const baseSeq = getMaxSequence(events, checkpointSeq);

  return {
    baseSeq,
    baseState: toPublicState(state),
    checkpointState: serializeState(state),
  };
};
