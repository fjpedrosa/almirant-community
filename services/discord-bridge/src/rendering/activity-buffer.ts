// ---------------------------------------------------------------------------
// Activity Buffer — groups tool calls and subagent events into burst messages
//
// Instead of sending individual Discord messages for each tool call, file
// operation, or bash command, the buffer collects them and flushes as a
// condensed summary after IDLE_FLUSH_MS of inactivity.
// ---------------------------------------------------------------------------

import {
  getToolEmoji,
  humanizeToolName,
  humanizeInputPreview,
  formatAgentType,
} from "./tool-humanizer";
import { truncate, MAX_MESSAGE_LENGTH } from "./content-transform";

const IDLE_FLUSH_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BufferedToolCall = {
  toolName: string;
  humanName: string;
  emoji: string;
  inputPreview?: string;
  success?: boolean;
  toolCallId: string;
};

export type BufferedSubagent = {
  subagentId: string;
  description: string;
  subagentType?: string;
  isBackground: boolean;
  tools: BufferedToolCall[];
  completed: boolean;
  success?: boolean;
};

type ActivityBufferState = {
  orphanTools: BufferedToolCall[];
  activeSubagent: BufferedSubagent | null;
  completedSubagents: BufferedSubagent[];
  threadId: string;
};

type DiscordOps = {
  send: (threadId: string, text: string, label: string) => Promise<void>;
  repinButtons: (jobId: string, threadId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Formatting helpers (pure functions)
// ---------------------------------------------------------------------------

const formatToolGroups = (
  tools: BufferedToolCall[],
  useTree: boolean,
): string[] => {
  const groups = new Map<string, BufferedToolCall[]>();
  for (const tool of tools) {
    const key = tool.humanName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tool);
  }

  const entries = Array.from(groups.entries());
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [humanName, calls] = entries[i];
    const isLast = i === entries.length - 1;
    const emoji = calls[0].emoji;

    const allDone = calls.every((c) => c.success !== undefined);
    const anyFailed = calls.some((c) => c.success === false);
    const statusEmoji = anyFailed
      ? "\u{274C}"
      : allDone
        ? "\u{2705}"
        : "\u{23F3}";

    const prefix = useTree ? (isLast ? "\u{2514}" : "\u{251C}") : " ";

    if (calls.length === 1) {
      const preview = calls[0].inputPreview
        ? ` \u{2192} ${truncate(calls[0].inputPreview, 60)}`
        : "";
      lines.push(`${prefix} ${emoji} ${humanName}${preview}  ${statusEmoji}`);
    } else {
      lines.push(`${prefix} ${emoji} ${humanName} \u{00D7} ${calls.length}  ${statusEmoji}`);
    }
  }

  return lines;
};

const formatBurstMessage = (buffer: ActivityBufferState): string => {
  const sections: string[] = [];

  for (const sub of buffer.completedSubagents) {
    const statusEmoji = sub.success === false ? "\u{274C}" : "\u{2705}";
    const agentLabel = formatAgentType(sub.subagentType);
    const toolCount = sub.tools.length;
    const toolSuffix = toolCount > 0 ? ` \u{2014} ${toolCount} tools` : "";

    if (toolCount > 0) {
      const toolLines = formatToolGroups(sub.tools, true);
      sections.push(
        `\u{1F916} **${agentLabel}** \u{2014} ${sub.description}\n${toolLines.join("\n")}`,
      );
    } else {
      sections.push(
        `\u{1F916} **${agentLabel}** \u{2014} ${sub.description}${toolSuffix}  ${statusEmoji}`,
      );
    }
  }

  if (buffer.activeSubagent) {
    const sub = buffer.activeSubagent;
    const agentLabel = formatAgentType(sub.subagentType);
    if (sub.tools.length > 0) {
      const toolLines = formatToolGroups(sub.tools, true);
      sections.push(
        `\u{1F916} **${agentLabel}** \u{2014} ${sub.description}\n${toolLines.join("\n")}`,
      );
    } else {
      sections.push(
        `\u{1F916} **${agentLabel}** \u{2014} ${sub.description}  \u{23F3}`,
      );
    }
  }

  if (buffer.orphanTools.length > 0) {
    const hasSubagents = buffer.completedSubagents.length > 0 || buffer.activeSubagent != null;
    if (hasSubagents) {
      const toolLines = formatToolGroups(buffer.orphanTools, false);
      sections.push(`\u{1F6E0}\u{FE0F} **Tool activity**\n${toolLines.join("\n")}`);
    } else {
      const toolLines = formatToolGroups(buffer.orphanTools, false);
      sections.push(toolLines.join("\n"));
    }
  }

  return sections.join("\n\n");
};

const hasBufferedContent = (buffer: ActivityBufferState): boolean =>
  buffer.orphanTools.length > 0 ||
  buffer.completedSubagents.length > 0 ||
  (buffer.activeSubagent != null && buffer.activeSubagent.tools.length > 0);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ActivityBuffer = {
  /** Add a tool call entry to the buffer. */
  bufferToolCall: (jobId: string, threadId: string, entry: BufferedToolCall) => void;
  /** Update a buffered tool call with its result. */
  updateToolResult: (jobId: string, toolCallId: string, success: boolean) => void;
  /** Record a subagent spawn. */
  spawnSubagent: (jobId: string, threadId: string, subagent: Omit<BufferedSubagent, "tools" | "completed">) => void;
  /** Record a subagent completion. */
  completeSubagent: (jobId: string, subagentId: string, success: boolean) => void;
  /** Flush the buffer — send condensed message to Discord. */
  flush: (jobId: string, threadId: string) => Promise<void>;
  /** Reset idle timer (e.g. after a tool result comes in). */
  resetTimer: (jobId: string, threadId: string) => void;
  /** Cleanup all state for a job. */
  cleanup: (jobId: string) => void;

  // Tool humanization helpers (re-exported for renderer convenience)
  buildToolEntry: (toolName: string, toolCallId: string, inputPreview?: string, success?: boolean) => BufferedToolCall;
};

export const createActivityBuffer = (ops: DiscordOps): ActivityBuffer => {
  const buffers = new Map<string, ActivityBufferState>();
  const idleFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const getOrCreateBuffer = (jobId: string, threadId: string): ActivityBufferState => {
    let buffer = buffers.get(jobId);
    if (!buffer) {
      buffer = {
        orphanTools: [],
        activeSubagent: null,
        completedSubagents: [],
        threadId,
      };
      buffers.set(jobId, buffer);
    }
    return buffer;
  };

  const clearIdleTimer = (jobId: string): void => {
    const timer = idleFlushTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      idleFlushTimers.delete(jobId);
    }
  };

  const resetIdleTimer = (jobId: string, threadId: string): void => {
    clearIdleTimer(jobId);
    const timer = setTimeout(async () => {
      idleFlushTimers.delete(jobId);
      await flush(jobId, threadId);
    }, IDLE_FLUSH_MS);
    idleFlushTimers.set(jobId, timer);
  };

  const flush = async (jobId: string, threadId: string): Promise<void> => {
    clearIdleTimer(jobId);
    const buffer = buffers.get(jobId);
    if (!buffer || !hasBufferedContent(buffer)) {
      buffers.delete(jobId);
      return;
    }

    const message = formatBurstMessage(buffer);
    buffers.delete(jobId);

    if (message.trim()) {
      await ops.send(threadId, truncate(message, MAX_MESSAGE_LENGTH), "flush-activity-burst");
      await ops.repinButtons(jobId, threadId);
    }
  };

  return {
    bufferToolCall: (jobId, threadId, entry) => {
      const buffer = getOrCreateBuffer(jobId, threadId);
      if (buffer.activeSubagent && !buffer.activeSubagent.completed) {
        buffer.activeSubagent.tools.push(entry);
      } else {
        buffer.orphanTools.push(entry);
      }
      resetIdleTimer(jobId, threadId);
    },

    updateToolResult: (jobId, toolCallId, success) => {
      const buffer = buffers.get(jobId);
      if (!buffer) return;

      for (const tool of buffer.orphanTools) {
        if (tool.toolCallId === toolCallId) { tool.success = success; return; }
      }
      if (buffer.activeSubagent) {
        for (const tool of buffer.activeSubagent.tools) {
          if (tool.toolCallId === toolCallId) { tool.success = success; return; }
        }
      }
      for (const sub of buffer.completedSubagents) {
        for (const tool of sub.tools) {
          if (tool.toolCallId === toolCallId) { tool.success = success; return; }
        }
      }
    },

    spawnSubagent: (jobId, threadId, subagent) => {
      const buffer = getOrCreateBuffer(jobId, threadId);

      if (buffer.activeSubagent) {
        buffer.activeSubagent.completed = true;
        buffer.completedSubagents.push(buffer.activeSubagent);
      }

      buffer.activeSubagent = {
        ...subagent,
        tools: [],
        completed: false,
      };

      resetIdleTimer(jobId, threadId);
    },

    completeSubagent: (jobId, subagentId, success) => {
      const buffer = buffers.get(jobId);
      if (buffer?.activeSubagent?.subagentId === subagentId) {
        buffer.activeSubagent.completed = true;
        buffer.activeSubagent.success = success;
        buffer.completedSubagents.push(buffer.activeSubagent);
        buffer.activeSubagent = null;
      }
      if (buffer) {
        resetIdleTimer(jobId, buffer.threadId);
      }
    },

    flush,

    resetTimer: resetIdleTimer,

    cleanup: (jobId) => {
      buffers.delete(jobId);
      clearIdleTimer(jobId);
    },

    buildToolEntry: (toolName, toolCallId, inputPreview?, success?) => ({
      toolName,
      humanName: humanizeToolName(toolName),
      emoji: getToolEmoji(toolName),
      inputPreview: inputPreview ? humanizeInputPreview(toolName, inputPreview) : undefined,
      toolCallId,
      success,
    }),
  };
};
