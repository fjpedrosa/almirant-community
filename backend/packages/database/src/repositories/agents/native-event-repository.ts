import { and, asc, eq, gt, sql } from "drizzle-orm";
import { sanitizeRuntimeDiagnostic } from "@almirant/shared";
import { db } from "../../client";
import {
  agentNativeEvents,
  type AgentNativeEventDb,
  type NewAgentNativeEvent,
} from "../../schema";

export interface AgentNativeEventFilters {
  afterSequence?: number;
  limit?: number;
}

export const AGENT_NATIVE_EVENT_LIMITS = Object.freeze({
  maxBatchSize: 250,
  nativeEventType: 120,
  sourceFormat: 50,
  runtimeSessionId: 255,
  model: 256,
});

export type AgentNativeEventValidationErrorCode =
  | "NATIVE_EVENT_BATCH_TOO_LARGE"
  | "NATIVE_EVENT_METADATA_INVALID"
  | "NATIVE_EVENT_RUNTIME_SELECTION_INVALID";

export class AgentNativeEventValidationError extends Error {
  public readonly code: AgentNativeEventValidationErrorCode;

  public constructor(code: AgentNativeEventValidationErrorCode) {
    super(`Native event rejected: ${code}`);
    this.name = "AgentNativeEventValidationError";
    this.code = code;
  }
}

const INFRASTRUCTURE_PROVIDERS = new Set([
  "claude-code",
  "codex",
  "zipu",
  "grok",
]);
const CODING_AGENTS = new Set(["claude-code", "codex", "opencode", "pi"]);
const AI_PROVIDERS = new Set(["anthropic", "openai", "google", "zai", "xai"]);

const assertBoundedString = (
  value: unknown,
  maximum: number,
  optional: boolean,
): void => {
  if (optional && (value === undefined || value === null)) return;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new AgentNativeEventValidationError("NATIVE_EVENT_METADATA_INVALID");
  }
};

const assertOptionalEnum = (value: unknown, allowed: ReadonlySet<string>): void => {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new AgentNativeEventValidationError("NATIVE_EVENT_METADATA_INVALID");
  }
};

const sanitizeAgentNativeEvent = (
  event: NewAgentNativeEvent,
): NewAgentNativeEvent => {
  if (
    !Number.isInteger(event.sequenceNum) ||
    event.sequenceNum < 0 ||
    event.sequenceNum > 2_147_483_647
  ) {
    throw new AgentNativeEventValidationError("NATIVE_EVENT_METADATA_INVALID");
  }

  assertBoundedString(
    event.nativeEventType,
    AGENT_NATIVE_EVENT_LIMITS.nativeEventType,
    false,
  );
  assertBoundedString(
    event.sourceFormat,
    AGENT_NATIVE_EVENT_LIMITS.sourceFormat,
    false,
  );
  assertBoundedString(
    event.runtimeSessionId,
    AGENT_NATIVE_EVENT_LIMITS.runtimeSessionId,
    true,
  );
  assertBoundedString(event.model, AGENT_NATIVE_EVENT_LIMITS.model, true);
  assertOptionalEnum(event.provider, INFRASTRUCTURE_PROVIDERS);
  assertOptionalEnum(event.codingAgent, CODING_AGENTS);
  assertOptionalEnum(event.aiProvider, AI_PROVIDERS);

  if (
    event.codingAgent === "pi" &&
    (event.provider !== "zipu" ||
      event.aiProvider !== "zai" ||
      event.model !== "glm-5.3")
  ) {
    throw new AgentNativeEventValidationError(
      "NATIVE_EVENT_RUNTIME_SELECTION_INVALID",
    );
  }

  return {
    ...event,
    payload: sanitizeRuntimeDiagnostic(event.payload) as Record<string, unknown>,
  };
};

export const insertAgentNativeEventsBatch = async (
  events: NewAgentNativeEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;
  if (events.length > AGENT_NATIVE_EVENT_LIMITS.maxBatchSize) {
    throw new AgentNativeEventValidationError("NATIVE_EVENT_BATCH_TOO_LARGE");
  }
  const sanitizedEvents = events.map(sanitizeAgentNativeEvent);

  const inserted = await db
    .insert(agentNativeEvents)
    .values(sanitizedEvents)
    .onConflictDoNothing({
      target: [agentNativeEvents.agentJobId, agentNativeEvents.sequenceNum],
    })
    .returning({ id: agentNativeEvents.id });

  return inserted.length;
};

export const getAgentNativeEventsByJobId = async (
  agentJobId: string,
  filters: AgentNativeEventFilters = {},
): Promise<AgentNativeEventDb[]> => {
  const conditions = [eq(agentNativeEvents.agentJobId, agentJobId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(agentNativeEvents.sequenceNum, filters.afterSequence));
  }

  return db
    .select()
    .from(agentNativeEvents)
    .where(and(...conditions))
    .orderBy(asc(agentNativeEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const getAgentNativeEventsBySessionId = async (
  planningSessionId: string,
  filters: AgentNativeEventFilters = {},
): Promise<AgentNativeEventDb[]> => {
  const conditions = [eq(agentNativeEvents.planningSessionId, planningSessionId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(agentNativeEvents.sequenceNum, filters.afterSequence));
  }

  return db
    .select()
    .from(agentNativeEvents)
    .where(and(...conditions))
    .orderBy(asc(agentNativeEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const countAgentNativeEventsBySessionId = async (
  planningSessionId: string,
): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentNativeEvents)
    .where(eq(agentNativeEvents.planningSessionId, planningSessionId));

  return row?.count ?? 0;
};

export const deleteAgentNativeEventsBySessionId = async (
  planningSessionId: string,
): Promise<number> => {
  const deleted = await db
    .delete(agentNativeEvents)
    .where(eq(agentNativeEvents.planningSessionId, planningSessionId))
    .returning({ id: agentNativeEvents.id });

  return deleted.length;
};

export const deleteAgentNativeEventsByJobId = async (
  agentJobId: string,
): Promise<number> => {
  const deleted = await db
    .delete(agentNativeEvents)
    .where(eq(agentNativeEvents.agentJobId, agentJobId))
    .returning({ id: agentNativeEvents.id });

  return deleted.length;
};
