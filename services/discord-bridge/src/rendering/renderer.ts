// ---------------------------------------------------------------------------
// Discord Renderer — slim coordinator
//
// Implements BridgeRenderer by delegating to specialized sub-modules:
// - TextAccumulator: text message accumulation and flush
// - ThinkingAccumulator: thinking block accumulation
// - ActivityBuffer: tool call / subagent burst buffering
// - TerminalCleaner: job completion/failure thread lifecycle
//
// This file orchestrates the flow; business logic lives in the sub-modules.
// ---------------------------------------------------------------------------

import type {
  BridgeRenderer,
  BridgeRendererContext,
  AgentTextEvent,
  AgentThinkingEvent,
  AgentToolCallStartEvent,
  AgentToolCallResultEvent,
  AgentFileReadEvent,
  AgentFileWriteEvent,
  AgentFileEditEvent,
  AgentBashExecuteEvent,
  AgentSubagentSpawnEvent,
  AgentSubagentCompleteEvent,
  AgentWaveStartEvent,
  AgentWaveDoneEvent,
  AgentWaveEndEvent,
  AgentQuestionEvent,
  AgentPermissionRequestEvent,
  AgentStepEvent,
  SessionIdleEvent,
  SessionAwaitingUserEvent,
  SessionErrorEvent,
  JobCompletedEvent,
  JobIncompleteEvent,
  JobFailedEvent,
  HeartbeatEvent,
  CanonicalEvent,
} from "@almirant/stream-consumer";
import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import { buildSessionControlComponents } from "@almirant/remote-agent";
import type { Logger } from "../platform/logger";
import { withRetry, type RetryOpts } from "../platform/retry";
import { sanitizeForDiscord } from "../platform/log-sanitizer";
import { passesContentFilter } from "../event-processing/event-classifier";
import { truncate, formatElapsed, MAX_MESSAGE_LENGTH, MAX_EMBED_DESCRIPTION } from "./content-transform";
import { createTextAccumulator, type TextAccumulator } from "./text-accumulator";
import { createThinkingAccumulator, type ThinkingAccumulator } from "./thinking-accumulator";
import { createActivityBuffer, type ActivityBuffer } from "./activity-buffer";
import { createTerminalCleaner, type TerminalCleaner } from "../thread-management/terminal-cleanup";
import { getToolEmoji, humanizeToolName, humanizeInputPreview } from "./tool-humanizer";
import type { BridgeEnv } from "../config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = {
  GREEN: 0x57f287,
  RED: 0xed4245,
  YELLOW: 0xfee75c,
} as const;

const HEARTBEAT_THROTTLE_MS = 30_000;
const SPINNER_FRAMES = ["\u28CB", "\u28D9", "\u28F9", "\u28F8", "\u28FC", "\u28F4", "\u28E6", "\u28E7", "\u28C7", "\u280F"] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DiscordRendererDeps = {
  adapter: DiscordRichChannelAdapter;
  contentFilter: BridgeEnv["DISCORD_CONTENT_FILTER"];
  log: Logger;
  retryOpts: { maxRetries: number; baseDelayMs: number };
};

export type DiscordRendererWithState = BridgeRenderer & {
  getStatusMessages: () => Map<string, { messageId: string; threadId: string }>;
  getTerminatedJobs: () => Set<string>;
  getPendingButtonOp: () => Set<string>;
  setStatusMessage: (jobId: string, messageId: string, threadId: string) => void;
  setThreadName: (jobId: string, threadId: string, name: string) => void;
  cleanupJob: (jobId: string) => void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createDiscordRenderer = (
  deps: DiscordRendererDeps,
): DiscordRendererWithState => {
  const { adapter, contentFilter, log, retryOpts } = deps;

  // -- Shared state --
  const statusMessages = new Map<string, { messageId: string; threadId: string }>();
  const terminatedJobs = new Set<string>();
  const pendingButtonOp = new Set<string>();
  const threadNames = new Map<string, { threadId: string; name: string }>();
  const lastHeartbeatEdit = new Map<string, number>();

  // -- Discord API helpers --
  const retry = <T>(fn: () => Promise<T>, label: string): Promise<T> =>
    withRetry(fn, { ...retryOpts, label });

  const send = async (threadId: string, text: string, label: string): Promise<void> => {
    await retry(() => adapter.sendMessage(threadId, truncate(text, MAX_MESSAGE_LENGTH)), label);
  };

  const sendRichAndTrack = async (threadId: string, content: string, label: string): Promise<string> => {
    const msg = await retry<{ id: string }>(
      () => adapter.sendRichMessage(threadId, {
        content: truncate(content, MAX_MESSAGE_LENGTH),
        allowed_mentions: { parse: [] },
      }),
      label,
    );
    return msg.id;
  };

  const editMessage = async (threadId: string, messageId: string, content: string, label: string): Promise<void> => {
    await retry(
      () => adapter.editRichMessage(threadId, messageId, {
        content: truncate(content, MAX_MESSAGE_LENGTH),
      }),
      label,
    );
  };

  const sendEmbed = async (
    threadId: string,
    embed: { title: string; description: string; color: number; timestamp?: string },
    label: string,
  ): Promise<void> => {
    await retry(
      () => adapter.sendRichMessage(threadId, {
        embeds: [{
          ...embed,
          description: truncate(embed.description, MAX_EMBED_DESCRIPTION),
          timestamp: embed.timestamp ?? new Date().toISOString(),
        }],
        allowed_mentions: { parse: [] },
      }),
      label,
    );
  };

  const repinButtons = async (jobId: string, threadId: string): Promise<void> => {
    if (terminatedJobs.has(jobId) || pendingButtonOp.has(jobId)) return;
    const tracked = statusMessages.get(jobId);
    if (!tracked) return;

    pendingButtonOp.add(jobId);
    try {
      const oldMessageId = tracked.messageId;
      const newMsg = await retry<{ id: string }>(
        () => adapter.sendRichMessage(threadId, {
          content: "\u28CB Processing...",
          components: buildSessionControlComponents(jobId, "running"),
          allowed_mentions: { parse: [] },
        }),
        "repin-buttons",
      );
      statusMessages.set(jobId, { messageId: newMsg.id, threadId });
      try { await adapter.deleteMessage(tracked.threadId, oldMessageId); } catch { /* best-effort */ }
    } catch (error) {
      log("debug", `Button repin failed for job ${jobId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      pendingButtonOp.delete(jobId);
    }
  };

  // -- Sub-modules --
  const discordOps = { sendRichAndTrack, editMessage, repinButtons };

  const textAcc: TextAccumulator = createTextAccumulator(discordOps);
  const thinkingAcc: ThinkingAccumulator = createThinkingAccumulator(discordOps);
  const activityBuf: ActivityBuffer = createActivityBuffer({ send, repinButtons });
  const terminalCleaner: TerminalCleaner = createTerminalCleaner({
    adapter,
    log,
    getStatusMessage: (jobId) => statusMessages.get(jobId),
    getThreadInfo: (jobId) => threadNames.get(jobId),
    markTerminated: (jobId) => terminatedJobs.add(jobId),
    deleteStatusMessage: (jobId) => statusMessages.delete(jobId),
    deleteThreadInfo: (jobId) => threadNames.delete(jobId),
  });

  // -- Shared flush helpers --
  const flushAll = async (jobId: string, threadId: string): Promise<void> => {
    await textAcc.flush(jobId);
    textAcc.finalize(jobId);
    await thinkingAcc.finalize(jobId);
    await activityBuf.flush(jobId, threadId);
  };

  const flushBeforeNonStreaming = async (jobId: string, threadId: string): Promise<void> => {
    await textAcc.flush(jobId);
    await activityBuf.flush(jobId, threadId);
    textAcc.finalize(jobId);
    await thinkingAcc.finalize(jobId);
  };

  const flushBeforeBufferable = async (jobId: string): Promise<void> => {
    await textAcc.flush(jobId);
    textAcc.finalize(jobId);
    await thinkingAcc.finalize(jobId);
  };

  const cleanupJobState = (jobId: string): void => {
    textAcc.cleanup(jobId);
    thinkingAcc.cleanup(jobId);
    activityBuf.cleanup(jobId);
    threadNames.delete(jobId);
    statusMessages.delete(jobId);
    lastHeartbeatEdit.delete(jobId);
  };

  // -- Renderer --
  const renderer: DiscordRendererWithState = {
    async renderText(event: AgentTextEvent, ctx: BridgeRendererContext): Promise<void> {
      if (!passesContentFilter("text", contentFilter)) return;
      if (!event.content) return;
      await activityBuf.flush(ctx.jobId, ctx.threadId);
      if (thinkingAcc.hasContent(ctx.jobId)) await thinkingAcc.finalize(ctx.jobId);
      textAcc.accumulate(ctx.jobId, ctx.threadId, event.content);
    },

    async renderThinking(event: AgentThinkingEvent, ctx: BridgeRendererContext): Promise<void> {
      if (!passesContentFilter("thinking", contentFilter)) return;
      const sanitized = sanitizeForDiscord(event.content);
      if (!sanitized) return;
      await textAcc.flush(ctx.jobId);
      await activityBuf.flush(ctx.jobId, ctx.threadId);
      if (textAcc.hasActiveMessage(ctx.jobId)) textAcc.finalize(ctx.jobId);
      await thinkingAcc.accumulate(ctx.jobId, ctx.threadId, sanitized);
    },

    async renderToolCallStart(event: AgentToolCallStartEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      activityBuf.bufferToolCall(ctx.jobId, ctx.threadId, {
        toolName: event.toolName,
        humanName: humanizeToolName(event.toolName),
        emoji: getToolEmoji(event.toolName),
        inputPreview: humanizeInputPreview(event.toolName, event.inputPreview),
        toolCallId: event.toolCallId,
      });
    },

    async renderToolCallResult(event: AgentToolCallResultEvent, ctx: BridgeRendererContext): Promise<void> {
      activityBuf.updateToolResult(ctx.jobId, event.toolCallId, event.success);
      activityBuf.resetTimer(ctx.jobId, ctx.threadId);
    },

    async renderFileRead(event: AgentFileReadEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      const range = event.lineRange ? ` (${event.lineRange})` : "";
      activityBuf.bufferToolCall(ctx.jobId, ctx.threadId, activityBuf.buildToolEntry("Read", event.toolCallId, `${event.filePath}${range}`, true));
    },

    async renderFileWrite(event: AgentFileWriteEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      activityBuf.bufferToolCall(ctx.jobId, ctx.threadId, activityBuf.buildToolEntry("Write", event.toolCallId, event.filePath, true));
    },

    async renderFileEdit(event: AgentFileEditEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      activityBuf.bufferToolCall(ctx.jobId, ctx.threadId, activityBuf.buildToolEntry("Edit", event.toolCallId, event.filePath, true));
    },

    async renderBashExecute(event: AgentBashExecuteEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      const preview = event.description || truncate(event.command, 60);
      activityBuf.bufferToolCall(ctx.jobId, ctx.threadId, activityBuf.buildToolEntry("Bash", event.toolCallId, preview));
    },

    async renderSubagentSpawn(event: AgentSubagentSpawnEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeBufferable(ctx.jobId);
      activityBuf.spawnSubagent(ctx.jobId, ctx.threadId, {
        subagentId: event.subagentId,
        description: event.description,
        subagentType: event.subagentType,
        isBackground: event.isBackground,
      });
    },

    async renderSubagentComplete(event: AgentSubagentCompleteEvent, ctx: BridgeRendererContext): Promise<void> {
      activityBuf.completeSubagent(ctx.jobId, event.subagentId, event.success);
    },

    async renderWaveStart(event: AgentWaveStartEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeNonStreaming(ctx.jobId, ctx.threadId);
      const lines = event.agents.map(
        (a: { agent: string; taskId: string; title: string }) =>
          `> \u{1F916} **${a.agent}** \u{2192} \`${a.taskId}\`: _${a.title}_`,
      );
      await send(ctx.threadId, `\u{1F680} **Subagents launched**\n${lines.join("\n")}`, "render-wave-start");
    },

    async renderAgentDone(event: AgentWaveDoneEvent, ctx: BridgeRendererContext): Promise<void> {
      const emoji = event.success ? "\u{2705}" : "\u{274C}";
      const reason = event.reason ? ` \u{2014} ${event.reason}` : "";
      await send(ctx.threadId, `${emoji} **${event.agent}** finished \`${event.taskId}\`${reason}`, "render-agent-done");
    },

    async renderWaveEnd(event: AgentWaveEndEvent, ctx: BridgeRendererContext): Promise<void> {
      await activityBuf.flush(ctx.jobId, ctx.threadId);
      await send(ctx.threadId, `\u{1F3C1} **Wave complete:** ${event.successCount}/${event.totalCount} succeeded`, "render-wave-end");
    },

    async renderQuestion(event: AgentQuestionEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeNonStreaming(ctx.jobId, ctx.threadId);
      const description = event.options?.length
        ? `${event.questionText}\n\n**Options:**\n${event.options.map((o: string) => `- ${o}`).join("\n")}`
        : event.questionText;
      await sendEmbed(ctx.threadId, { title: "User input required", description, color: COLORS.YELLOW }, "render-question");
    },

    async renderPermissionRequest(event: AgentPermissionRequestEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeNonStreaming(ctx.jobId, ctx.threadId);
      const description = event.description ? `\`${event.toolName}\`\n\n${event.description}` : `\`${event.toolName}\``;
      await sendEmbed(ctx.threadId, { title: "Permission requested", description, color: COLORS.YELLOW }, "render-permission-request");
    },

    async renderStep(event: AgentStepEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeNonStreaming(ctx.jobId, ctx.threadId);
      await send(ctx.threadId, `\u{1F527} > ${event.description}`, "render-step");
    },

    async renderSessionIdle(_event: SessionIdleEvent, _ctx: BridgeRendererContext): Promise<void> {},
    async renderSessionAwaitingUser(_event: SessionAwaitingUserEvent, _ctx: BridgeRendererContext): Promise<void> {},

    async renderSessionError(event: SessionErrorEvent, ctx: BridgeRendererContext): Promise<void> {
      await flushBeforeNonStreaming(ctx.jobId, ctx.threadId);
      await sendEmbed(ctx.threadId, { title: "\u{274C} Session Error", description: event.message, color: COLORS.RED }, "render-session-error");
    },

    async renderJobCompleted(event: JobCompletedEvent, ctx: BridgeRendererContext): Promise<void> {
      await textAcc.flush(ctx.jobId);
      textAcc.finalize(ctx.jobId);
      await activityBuf.flush(ctx.jobId, ctx.threadId);

      const elapsed = event.elapsedMs != null ? ` in ${formatElapsed(event.elapsedMs)}` : "";
      const recentText = textAcc.getLastTextContent(ctx.jobId);

      if (recentText && recentText.content.trim().length > 0) {
        try { await adapter.deleteMessage(recentText.threadId, recentText.messageId); } catch { /* best-effort */ }
        await sendEmbed(ctx.threadId, {
          title: `\u{2705} Execution Completed${elapsed}`,
          description: truncate(recentText.content, MAX_EMBED_DESCRIPTION),
          color: COLORS.GREEN,
        }, "render-job-completed-summary");
      } else {
        const summary = event.summary ?? "Execution completed.";
        await sendEmbed(ctx.threadId, {
          title: `\u{2705} Execution Completed${elapsed}`,
          description: summary,
          color: COLORS.GREEN,
        }, "render-job-completed");
      }

      await terminalCleaner.cleanup(ctx.jobId);
    },

    async renderJobIncomplete(event: JobIncompleteEvent, ctx: BridgeRendererContext): Promise<void> {
      await textAcc.flush(ctx.jobId);
      textAcc.finalize(ctx.jobId);
      await activityBuf.flush(ctx.jobId, ctx.threadId);

      const elapsed = event.elapsedMs != null ? ` in ${formatElapsed(event.elapsedMs)}` : "";
      const missingCount = event.missingWorkItemIds?.length ?? 0;
      const missingText = missingCount > 0 ? `\n\nMissing task reconciliations: ${missingCount}` : "";
      await sendEmbed(ctx.threadId, {
        title: `\u26a0\ufe0f Execution Incomplete${elapsed}`,
        description: truncate(`${event.summary ?? "Execution finished incomplete."}${missingText}`, MAX_EMBED_DESCRIPTION),
        color: COLORS.YELLOW,
      }, "render-job-incomplete");

      await terminalCleaner.cleanup(ctx.jobId, "incomplete");
    },

    async renderJobFailed(event: JobFailedEvent, ctx: BridgeRendererContext): Promise<void> {
      await textAcc.flush(ctx.jobId);
      await activityBuf.flush(ctx.jobId, ctx.threadId);

      const elapsed = event.elapsedMs != null ? ` after ${formatElapsed(event.elapsedMs)}` : "";
      await sendEmbed(ctx.threadId, {
        title: `\u{274C} Execution Failed${elapsed}`,
        description: event.errorMessage,
        color: COLORS.RED,
      }, "render-job-failed");

      await terminalCleaner.cleanup(ctx.jobId, "failed");
    },

    async renderHeartbeat(event: HeartbeatEvent, ctx: BridgeRendererContext): Promise<void> {
      if (terminatedJobs.has(ctx.jobId)) return;
      const tracked = statusMessages.get(ctx.jobId);
      if (!tracked) return;

      const now = Date.now();
      const lastEdit = lastHeartbeatEdit.get(ctx.jobId) ?? 0;
      if (now - lastEdit < HEARTBEAT_THROTTLE_MS) return;

      const elapsedMs = typeof event.elapsedMs === "number" ? event.elapsedMs : 0;
      const frame = SPINNER_FRAMES[Math.floor(elapsedMs / 1000) % SPINNER_FRAMES.length];
      const elapsed = formatElapsed(elapsedMs);

      try {
        await adapter.editRichMessage(tracked.threadId, tracked.messageId, {
          content: `${frame} Processing... (${elapsed})`,
          components: buildSessionControlComponents(ctx.jobId, "running"),
        });
        lastHeartbeatEdit.set(ctx.jobId, now);
      } catch (error) {
        log("debug", `Heartbeat edit failed for job ${ctx.jobId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async renderMessageQueued(): Promise<void> {},
    async renderMessageDequeued(): Promise<void> {},

    async onSilencedEvent(event: CanonicalEvent, ctx: BridgeRendererContext): Promise<void> {
      if (event.kind === "job.cancelled" || event.kind === "job.timeout") {
        await textAcc.flush(ctx.jobId);
        textAcc.finalize(ctx.jobId);
        await thinkingAcc.finalize(ctx.jobId);
        await terminalCleaner.cleanup(ctx.jobId, "failed");
        return;
      }

      if (event.kind === "system.info") {
        const threadId = ctx.threadId;
        if (!threadId) return;

        if (event.payload?.threadRename && typeof event.payload.name === "string") {
          try { await adapter.renameThread(threadId, event.payload.name); } catch { /* best-effort */ }
          threadNames.set(ctx.jobId, { threadId, name: event.payload.name });
          return;
        }

        const content = sanitizeForDiscord(event.message);
        if (content.trim()) {
          try {
            await adapter.sendRichMessage(threadId, {
              content: `\u{1F4AC} ${content}`,
              allowed_mentions: { parse: [] },
            });
            await repinButtons(ctx.jobId, threadId);
          } catch { /* best-effort */ }
        }
        return;
      }

      log("debug", `Silenced canonical event: ${event.kind}`, {
        sessionId: ctx.sessionId, jobId: ctx.jobId, threadId: ctx.threadId,
      });
    },

    // -- State accessors for consumer integration --
    getStatusMessages: () => statusMessages,
    getTerminatedJobs: () => terminatedJobs,
    getPendingButtonOp: () => pendingButtonOp,
    setStatusMessage: (jobId, messageId, threadId) => statusMessages.set(jobId, { messageId, threadId }),
    setThreadName: (jobId, threadId, name) => threadNames.set(jobId, { threadId, name }),
    cleanupJob: cleanupJobState,
  };

  return renderer;
};
