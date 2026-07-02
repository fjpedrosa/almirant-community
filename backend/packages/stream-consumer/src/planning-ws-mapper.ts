import type { CanonicalEvent, CanonicalEventEnvelope } from "./canonical-events";

export type PlanningWsMessage = {
  type: string;
  payload: Record<string, unknown>;
};

type PlanningWsContext = Pick<CanonicalEventEnvelope, "sessionId" | "sequenceNumber">;

const GENERIC_MCP_TOOL_NAMES = new Set(["mcp_tool", "MCP tool"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toString = (value: unknown): string | undefined =>
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
      toString(parsed.name) ??
      toString(parsed.toolName) ??
      toString(parsed.tool_name);
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

  return buildMcpToolName(serverMatch?.[1], toolMatch?.[1]) ?? toolName;
};

export const mapCanonicalEventToPlanningWsMessage = (
  event: CanonicalEvent,
  ctx: PlanningWsContext,
): PlanningWsMessage | null => {
  const sequencedPayload = <T extends Record<string, unknown>>(payload: T): T & { sequenceNum: number } => ({
    ...payload,
    sequenceNum: ctx.sequenceNumber,
  });

  switch (event.kind) {
    case "agent.text":
      return {
        type: "planning:text",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          content: event.content,
        }),
      };

    case "agent.thinking":
      return {
        type: "planning:thinking",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          content: event.content,
        }),
      };

    case "agent.tool_call.start":
      return {
        type: "planning:tool-call-start",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          toolCallId: event.toolCallId,
          toolName: normalizePlanningToolName(
            event.toolName,
            event.inputPreview,
          ),
          inputPreview: event.inputPreview,
        }),
      };

    case "agent.tool_call.result":
      return {
        type: "planning:tool-call-result",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          toolCallId: event.toolCallId,
          toolName: normalizePlanningToolName(
            event.toolName,
            event.outputPreview,
          ),
          success: event.success,
          outputPreview: event.outputPreview,
        }),
      };

    case "agent.file.read":
      return {
        type: "planning:file-read",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          lineRange: event.lineRange,
        }),
      };

    case "agent.file.write":
      return {
        type: "planning:file-change",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          operation: "write",
        }),
      };

    case "agent.file.edit":
      return {
        type: "planning:file-change",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          filePath: event.filePath,
          operation: "edit",
        }),
      };

    case "agent.bash.execute":
      return {
        type: "planning:bash-execute",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          command: event.command,
          description: event.description,
        }),
      };

    case "agent.subagent.spawn":
      return {
        type: "planning:subagent-spawn",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          subagentId: event.subagentId,
          description: event.description,
          isBackground: event.isBackground,
          subagentType: event.subagentType,
        }),
      };

    case "agent.subagent.complete":
      return {
        type: "planning:subagent-complete",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          subagentId: event.subagentId,
          success: event.success,
        }),
      };

    case "agent.wave.start":
      return {
        type: "planning:wave-start",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          agents: event.agents.map((agent) => ({
            id: agent.agent,
            name: agent.agent,
            role: agent.title,
          })),
        }),
      };

    case "agent.wave.agent_done":
      return {
        type: "planning:agent-done",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          agentId: event.agent,
          success: event.success,
          ...(event.reason ? { reason: event.reason } : {}),
        }),
      };

    case "agent.wave.end":
      return {
        type: "planning:wave-end",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          successCount: event.successCount,
          totalCount: event.totalCount,
        }),
      };

    case "agent.question":
      return {
        type: "planning:question",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          questionId: `question-${ctx.sequenceNumber}`,
          questionText: event.questionText,
          options: event.options ?? [],
          ...(event.questions ? { questions: event.questions } : {}),
          ...(event.questionType ? { questionType: event.questionType } : {}),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      };

    case "agent.permission.request":
      return {
        type: "planning:question",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          questionId: `permission-${ctx.sequenceNumber}`,
          questionText: `Permission requested: ${event.toolName}`,
          options: ["Allow", "Deny"],
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      };

    case "agent.step":
      return {
        type: "planning:step",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          stepName: event.description,
          stepIndex: 0,
        }),
      };

    case "session.idle":
      return {
        type: "planning:response-complete",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
        }),
      };

    case "session.awaiting_user":
      return {
        type: "planning:response-complete",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          requiresFollowUp: true,
          followUpPrompt: event.prompt,
          ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
        }),
      };

    case "session.error":
      return {
        type: "planning:error",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          message: event.message,
        }),
      };

    case "job.completed":
      return {
        type: "planning:done",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          summary: event.summary,
        }),
      };

    case "job.failed":
      return {
        type: "planning:error",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          message: event.errorMessage,
        }),
      };

    case "job.incomplete":
      return {
        type: "planning:done",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          summary: event.summary,
        }),
      };

    case "message.queued":
      return {
        type: "planning:message-queued",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          messageId: event.messageId,
          position: event.position,
          queueDepth: event.queueDepth,
        }),
      };

    case "message.dequeued":
      return {
        type: "planning:message-dequeued",
        payload: sequencedPayload({
          sessionId: ctx.sessionId,
          messageId: event.messageId,
          remainingInQueue: event.remainingInQueue,
        }),
      };

    case "agent.text.complete":
    case "agent.bash.output":
    case "agent.question.resolved":
    case "user.answer.submitted":
    case "turn.started":
    case "turn.awaiting_user":
    case "turn.resumed":
    case "turn.completed":
    case "session.connected":
    case "session.closed":
    case "job.started":
    case "job.cancelled":
    case "job.timeout":
    case "heartbeat":
    case "system.info":
    case "system.warn":
      return null;
  }

  return null;
};
