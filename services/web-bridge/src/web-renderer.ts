import type { BridgeRenderer, BridgeRendererContext } from "@almirant/stream-consumer";
import type Redis from "ioredis";

type WsMessage = { type: string; payload: Record<string, unknown> };

type WebRendererDeps = {
  pubsubRedis: Redis;
  pubsubChannel: string;
  log: (level: string, message: string, meta?: Record<string, unknown>) => void;
  onPublish?: () => void;
};

/**
 * Creates a BridgeRenderer that maps canonical events to WsServerMessage
 * objects and publishes them to Redis Pub/Sub for the WebSocket layer.
 *
 * This is the canonical-event equivalent of the legacy `mapCanonicalEventToWsMessage`
 * function, but structured as a renderer so it integrates with `createCanonicalRouter`.
 */
export const createWebRenderer = (deps: WebRendererDeps): BridgeRenderer => {
  const { pubsubRedis, pubsubChannel, onPublish } = deps;

  const publish = async (
    ctx: BridgeRendererContext,
    wsMessage: WsMessage,
  ): Promise<void> => {
    const payload = JSON.stringify({
      organizationId: ctx.organizationId,
      message: wsMessage,
    });
    await pubsubRedis.publish(pubsubChannel, payload);
    onPublish?.();
  };

  return {
    // ---- Agent output ----

    renderText: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:text",
        payload: { sessionId: ctx.sessionId, content: event.content, sequenceNum: ctx.sequenceNumber, jobId: ctx.jobId },
      });
    },

    renderThinking: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:thinking",
        payload: { sessionId: ctx.sessionId, content: event.content, sequenceNum: ctx.sequenceNumber, jobId: ctx.jobId },
      });
    },

    // ---- Tool calls ----

    renderToolCallStart: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:tool-call-start",
        payload: {
          sessionId: ctx.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          inputPreview: event.inputPreview,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    renderToolCallResult: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:tool-call-result",
        payload: {
          sessionId: ctx.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          success: event.success,
          outputPreview: event.outputPreview,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    // ---- File operations ----

    renderFileRead: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:file-read",
        payload: {
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          lineRange: event.lineRange,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    renderFileWrite: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:file-change",
        payload: {
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          operation: "write",
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    renderFileEdit: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:file-change",
        payload: {
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          operation: "edit",
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    // ---- Shell ----

    renderBashExecute: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:bash-execute",
        payload: {
          sessionId: ctx.sessionId,
          command: event.command,
          description: event.description,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    // ---- Sub-agents ----

    renderSubagentSpawn: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:subagent-spawn",
        payload: {
          sessionId: ctx.sessionId,
          subagentId: event.subagentId,
          description: event.description,
          isBackground: event.isBackground,
          subagentType: event.subagentType,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    renderSubagentComplete: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:subagent-complete",
        payload: {
          sessionId: ctx.sessionId,
          subagentId: event.subagentId,
          success: event.success,
          sequenceNum: ctx.sequenceNumber,
          jobId: ctx.jobId,
        },
      });
    },

    // ---- Waves ----

    renderWaveStart: async (event, ctx) => {
      const agents = event.agents.map((a) => ({
        id: a.agent,
        name: a.agent,
        role: a.title,
      }));
      await publish(ctx, {
        type: "planning:wave-start",
        payload: { sessionId: ctx.sessionId, agents },
      });
    },

    renderAgentDone: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:agent-done",
        payload: {
          sessionId: ctx.sessionId,
          agentId: event.agent,
          success: event.success,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      });
    },

    renderWaveEnd: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:wave-end",
        payload: {
          sessionId: ctx.sessionId,
          successCount: event.successCount,
          totalCount: event.totalCount,
        },
      });
    },

    // ---- Interaction ----

    renderQuestion: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:question",
        payload: {
          sessionId: ctx.sessionId,
          questionId: `question-${ctx.sequenceNumber}`,
          questionText: event.questionText,
          options: event.options ?? [],
          ...(event.questionType ? { questionType: event.questionType } : {}),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      });
    },

    renderPermissionRequest: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:question",
        payload: {
          sessionId: ctx.sessionId,
          questionId: "",
          questionText: `Permission requested: ${event.toolName}`,
          options: ["Allow", "Deny"],
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      });
    },

    renderStep: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:step",
        payload: { sessionId: ctx.sessionId, stepName: event.description, stepIndex: 0, sequenceNum: ctx.sequenceNumber, jobId: ctx.jobId },
      });
    },

    // ---- Session lifecycle ----

    renderSessionIdle: async (_event, ctx) => {
      await publish(ctx, {
        type: "planning:response-complete",
        payload: { sessionId: ctx.sessionId },
      });
    },

    renderSessionAwaitingUser: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:response-complete",
        payload: {
          sessionId: ctx.sessionId,
          requiresFollowUp: true,
          followUpPrompt: event.prompt,
          ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
        },
      });
    },

    renderSessionError: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:error",
        payload: {
          sessionId: ctx.sessionId,
          message: event.message,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
          ...(event.errorCategory ? { errorCategory: event.errorCategory } : {}),
          ...(event.recoverable !== undefined ? { recoverable: event.recoverable } : {}),
        },
      });
    },

    // ---- Job lifecycle ----

    renderJobCompleted: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:done",
        payload: {
          sessionId: ctx.sessionId,
          summary: event.summary,
        },
      });
    },

    renderJobIncomplete: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:done",
        payload: {
          sessionId: ctx.sessionId,
          summary: event.summary,
        },
      });
    },

    renderJobFailed: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:error",
        payload: {
          sessionId: ctx.sessionId,
          message: event.errorMessage,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
          ...(event.errorCategory ? { errorCategory: event.errorCategory } : {}),
        },
      });
    },

    // ---- Message queue ----

    renderMessageQueued: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:message-queued",
        payload: {
          sessionId: ctx.sessionId,
          messageId: event.messageId,
          position: event.position,
          queueDepth: event.queueDepth,
        },
      });
    },

    renderMessageDequeued: async (event, ctx) => {
      await publish(ctx, {
        type: "planning:message-dequeued",
        payload: {
          sessionId: ctx.sessionId,
          messageId: event.messageId,
          remainingInQueue: event.remainingInQueue,
        },
      });
    },

    // ---- System ----

    renderHeartbeat: async () => {
      // Heartbeat events are not broadcast to the frontend
    },
  };
};
