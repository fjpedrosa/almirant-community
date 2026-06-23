import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "../../client";
import { agentJobLogs, agentJobs } from "../../schema";
import type { AgentJobLogLevel } from "../../schema/agent-job-logs";

export interface CreateAgentJobLogInput {
  jobId: string;
  orgId: string;
  workItemId?: string | null;
  seq: number;
  level: AgentJobLogLevel;
  phase: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
  contentType?: string;
  timestamp: Date;
}

export interface ListAgentJobLogsFilters {
  level?: AgentJobLogLevel;
  phase?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  cursor?: number;
  limit?: number;
}

export interface ListAgentJobLogsResult {
  logs: typeof agentJobLogs.$inferSelect[];
  nextCursor: number | null;
}

export interface DeleteAgentJobLogsFilters {
  orgId?: string;
}

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

export const createAgentJobLogBatch = async (
  logs: CreateAgentJobLogInput[]
): Promise<typeof agentJobLogs.$inferSelect[]> => {
  if (logs.length === 0) return [];

  return db
    .insert(agentJobLogs)
    .values(
      logs.map((entry) => ({
        jobId: entry.jobId,
        orgId: entry.orgId,
        workItemId: entry.workItemId ?? null,
        seq: entry.seq,
        level: entry.level,
        phase: entry.phase,
        eventType: entry.eventType,
        message: entry.message,
        payload: entry.payload ?? {},
        contentType: entry.contentType ?? "text",
        timestamp: entry.timestamp,
      }))
    )
    .onConflictDoNothing({ target: [agentJobLogs.jobId, agentJobLogs.seq] })
    .returning();
};

export const createSequentialAgentJobLog = async (
  entry: Omit<CreateAgentJobLogInput, "seq">
): Promise<typeof agentJobLogs.$inferSelect | null> => {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${entry.jobId}))`,
    );

    const [current] = await tx
      .select({
        maxSeq: sql<number>`coalesce(max(${agentJobLogs.seq}), 0)::int`,
      })
      .from(agentJobLogs)
      .where(eq(agentJobLogs.jobId, entry.jobId));

    const nextSeq = (current?.maxSeq ?? 0) + 1;

    const [created] = await tx
      .insert(agentJobLogs)
      .values({
        jobId: entry.jobId,
        orgId: entry.orgId,
        workItemId: entry.workItemId ?? null,
        seq: nextSeq,
        level: entry.level,
        phase: entry.phase,
        eventType: entry.eventType,
        message: entry.message,
        payload: entry.payload ?? {},
        contentType: entry.contentType ?? "text",
        timestamp: entry.timestamp,
      })
      .returning();

    return created ?? null;
  });
};

export const listAgentJobLogsByJobId = async (
  jobId: string,
  filters?: ListAgentJobLogsFilters
): Promise<ListAgentJobLogsResult> => {
  const safeLimit = Math.max(1, Math.min(filters?.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const conditions = [eq(agentJobLogs.jobId, jobId)];

  if (filters?.level) conditions.push(eq(agentJobLogs.level, filters.level));
  if (filters?.phase) conditions.push(eq(agentJobLogs.phase, filters.phase));
  if (filters?.eventType) conditions.push(eq(agentJobLogs.eventType, filters.eventType));
  if (filters?.from) conditions.push(gte(agentJobLogs.timestamp, filters.from));
  if (filters?.to) conditions.push(lte(agentJobLogs.timestamp, filters.to));
  if (typeof filters?.cursor === "number") conditions.push(sql`${agentJobLogs.seq} > ${filters.cursor}`);

  const rows = await db
    .select()
    .from(agentJobLogs)
    .where(and(...conditions))
    .orderBy(asc(agentJobLogs.seq), asc(agentJobLogs.timestamp))
    .limit(safeLimit);

  const nextCursor = rows.length === safeLimit ? rows[rows.length - 1]?.seq ?? null : null;
  return {
    logs: rows,
    nextCursor,
  };
};

/**
 * Convenience function to retrieve raw transcript entries for a given job.
 * Filters by phase="transcript" and returns entries ordered by seq for
 * faithful reconstruction of the agent's raw output stream.
 */
export const getTranscriptByJobId = async (
  jobId: string,
  filters?: { cursor?: number; limit?: number; tail?: boolean }
): Promise<ListAgentJobLogsResult> => {
  if (filters?.tail === true) {
    const safeLimit = Math.max(1, Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    const rows = await db
      .select()
      .from(agentJobLogs)
      .where(
        and(
          eq(agentJobLogs.jobId, jobId),
          eq(agentJobLogs.phase, "transcript"),
          eq(agentJobLogs.eventType, "raw_output"),
        ),
      )
      .orderBy(desc(agentJobLogs.seq), desc(agentJobLogs.timestamp))
      .limit(safeLimit);

    return {
      logs: rows.reverse(),
      nextCursor: null,
    };
  }

  return listAgentJobLogsByJobId(jobId, {
    phase: "transcript",
    eventType: "raw_output",
    cursor: filters?.cursor,
    limit: filters?.limit,
  });
};

/**
 * Get the last N error-level log entries for a job, useful for quick diagnosis.
 * Returns error logs + the last few transcript entries for context.
 */
export const getJobErrorSummary = async (
  jobId: string,
  options?: { errorLimit?: number; contextLimit?: number }
): Promise<{
  errors: (typeof agentJobLogs.$inferSelect)[];
  lastContext: (typeof agentJobLogs.$inferSelect)[];
}> => {
  const errorLimit = options?.errorLimit ?? 10;
  const contextLimit = options?.contextLimit ?? 20;

  const [errors, lastContext] = await Promise.all([
    db
      .select()
      .from(agentJobLogs)
      .where(
        and(
          eq(agentJobLogs.jobId, jobId),
          eq(agentJobLogs.level, "error")
        )
      )
      .orderBy(desc(agentJobLogs.seq))
      .limit(errorLimit),
    db
      .select()
      .from(agentJobLogs)
      .where(
        and(
          eq(agentJobLogs.jobId, jobId),
          eq(agentJobLogs.phase, "transcript")
        )
      )
      .orderBy(desc(agentJobLogs.timestamp), desc(agentJobLogs.seq))
      .limit(contextLimit),
  ]);

  return { errors, lastContext: lastContext.reverse() };
};

/**
 * Build conversation history from agent_job_logs for a planning session.
 * Used to provide context when a follow-up planning job starts in a new container.
 */
export const getConversationHistoryFromLogs = async (
  jobId: string,
  options?: { maxMessages?: number; maxChars?: number }
): Promise<Array<{ role: string; content: string }>> => {
  const maxMessages = options?.maxMessages ?? 50;
  const maxChars = options?.maxChars ?? 100_000;

  const logs = await db
    .select({
      contentType: agentJobLogs.contentType,
      message: agentJobLogs.message,
    })
    .from(agentJobLogs)
    .where(
      and(
        eq(agentJobLogs.jobId, jobId),
        eq(agentJobLogs.phase, "transcript"),
        inArray(agentJobLogs.contentType, ["text", "user_input"]),
      )
    )
    .orderBy(asc(agentJobLogs.timestamp), asc(agentJobLogs.seq));

  const history: Array<{ role: string; content: string }> = [];
  let currentRole: string | null = null;
  let currentContent = "";

  for (const log of logs) {
    const role = log.contentType === "user_input" ? "user" : "assistant";
    if (role === currentRole) {
      currentContent += log.message;
    } else {
      if (currentRole && currentContent.trim()) {
        history.push({ role: currentRole, content: currentContent.trim() });
      }
      currentRole = role;
      currentContent = log.message;
    }
  }
  if (currentRole && currentContent.trim()) {
    history.push({ role: currentRole, content: currentContent.trim() });
  }

  // Trim to fit within limits
  const trimmed = history.slice(-maxMessages);
  let totalChars = 0;
  const result: Array<{ role: string; content: string }> = [];
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const entry = trimmed[i]!;
    totalChars += entry.content.length;
    if (totalChars > maxChars) break;
    result.unshift(entry);
  }

  return result;
};

/**
 * Find the most recent job for a planning session (any status).
 * Useful for fetching conversation history from the last completed job.
 */
export const getLatestJobForPlanningSession = async (
  planningSessionId: string
): Promise<{ id: string; codingAgent: string; aiProvider: string; model: string; provider: string } | null> => {
  const [row] = await db
    .select({
      id: agentJobs.id,
      codingAgent: agentJobs.codingAgent,
      aiProvider: agentJobs.aiProvider,
      model: agentJobs.model,
      provider: agentJobs.provider,
    })
    .from(agentJobs)
    .where(eq(agentJobs.planningSessionId, planningSessionId))
    .orderBy(desc(agentJobs.createdAt))
    .limit(1);

  return row ?? null;
};

export const getPlanningSessionUserInputs = async (
  planningSessionId: string,
  options?: { limit?: number },
): Promise<Array<{
  jobId: string;
  message: string;
  payload: Record<string, unknown> | null;
  timestamp: Date;
}>> => {
  return db
    .select({
      jobId: agentJobLogs.jobId,
      message: agentJobLogs.message,
      payload: agentJobLogs.payload,
      timestamp: agentJobLogs.timestamp,
    })
    .from(agentJobLogs)
    .innerJoin(agentJobs, eq(agentJobLogs.jobId, agentJobs.id))
    .where(
      and(
        eq(agentJobs.planningSessionId, planningSessionId),
        eq(agentJobLogs.phase, "transcript"),
        eq(agentJobLogs.contentType, "user_input"),
      ),
    )
    .orderBy(asc(agentJobLogs.timestamp), asc(agentJobLogs.seq))
    .limit(options?.limit ?? 500);
};

// --- Enriched conversation history with tool_use support ---

export interface EnrichedToolCall {
  toolName: string;
  toolCallId: string;
  input: string;
}

export interface EnrichedMessage {
  role: string;
  content: string;
  toolCalls?: EnrichedToolCall[];
}

/**
 * Build enriched conversation history from agent_job_logs, including tool_use entries.
 * Tool inputs are truncated to ~500 chars to keep payloads manageable.
 */
export const getEnrichedConversationHistory = async (
  jobId: string,
  options?: { maxMessages?: number; maxChars?: number }
): Promise<EnrichedMessage[]> => {
  const maxMessages = options?.maxMessages ?? 50;
  const maxChars = options?.maxChars ?? 120_000;

  const logs = await db
    .select({
      contentType: agentJobLogs.contentType,
      message: agentJobLogs.message,
      payload: agentJobLogs.payload,
    })
    .from(agentJobLogs)
    .where(
      and(
        eq(agentJobLogs.jobId, jobId),
        eq(agentJobLogs.phase, "transcript"),
        inArray(agentJobLogs.contentType, ["text", "user_input", "tool_use"]),
      )
    )
    .orderBy(asc(agentJobLogs.timestamp), asc(agentJobLogs.seq));

  const history: EnrichedMessage[] = [];
  let currentRole: string | null = null;
  let currentContent = "";
  let currentToolCalls: EnrichedToolCall[] = [];

  const truncate = (s: string, max = 500): string =>
    s.length > max ? s.slice(0, max) + "..." : s;

  const flushMessage = () => {
    if (currentRole && (currentContent.trim() || currentToolCalls.length > 0)) {
      const msg: EnrichedMessage = { role: currentRole, content: currentContent.trim() };
      if (currentToolCalls.length > 0) {
        msg.toolCalls = currentToolCalls;
      }
      history.push(msg);
    }
    currentContent = "";
    currentToolCalls = [];
  };

  for (const log of logs) {
    const role = log.contentType === "user_input" ? "user" : "assistant";

    if (role !== currentRole) {
      flushMessage();
      currentRole = role;
    }

    if (log.contentType === "tool_use") {
      try {
        const parsed = JSON.parse(log.message);
        currentToolCalls.push({
          toolName: parsed.name || parsed.toolName || "unknown",
          toolCallId: parsed.id || parsed.toolCallId || "",
          input: truncate(
            typeof parsed.input === "string"
              ? parsed.input
              : JSON.stringify(parsed.input ?? {})
          ),
        });
      } catch {
        currentToolCalls.push({
          toolName: "unknown",
          toolCallId: "",
          input: truncate(log.message),
        });
      }
    } else {
      currentContent += log.message;
    }
  }
  flushMessage();

  // Trim to fit within limits (keep most recent messages)
  const trimmed = history.slice(-maxMessages);
  let totalChars = 0;
  const result: EnrichedMessage[] = [];
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const entry = trimmed[i]!;
    const entryChars =
      entry.content.length +
      (entry.toolCalls?.reduce(
        (sum, tc) => sum + tc.input.length + tc.toolName.length,
        0
      ) ?? 0);
    totalChars += entryChars;
    if (totalChars > maxChars) break;
    result.unshift(entry);
  }

  return result;
};

export const deleteAgentJobLogsBeforeTimestamp = async (
  before: Date,
  limit: number,
  filters?: DeleteAgentJobLogsFilters
): Promise<number> => {
  const safeLimit = Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
  const conditions = [lt(agentJobLogs.timestamp, before)];
  if (filters?.orgId) conditions.push(eq(agentJobLogs.orgId, filters.orgId));

  const rows = await db
    .select({ id: agentJobLogs.id })
    .from(agentJobLogs)
    .where(and(...conditions))
    .orderBy(asc(agentJobLogs.timestamp), asc(agentJobLogs.seq))
    .limit(safeLimit);

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return 0;

  const deletedRows = await db
    .delete(agentJobLogs)
    .where(inArray(agentJobLogs.id, ids))
    .returning({ id: agentJobLogs.id });

  return deletedRows.length;
};
