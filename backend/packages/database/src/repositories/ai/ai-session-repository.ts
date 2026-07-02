import { db } from "../../client";
import { aiSessions } from "../../schema";
import { workItems } from "../../schema/work-items";
import { projects } from "../../schema/projects";
import { eq, and, desc, sql } from "drizzle-orm";
import type { NewAiSession, AiSessionDb } from "../../schema/ai-sessions";

export interface AiSessionSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: string;
  totalDurationMs: number;
  sessionCount: number;
}

export interface AiSessionWithSummary {
  sessions: AiSessionDb[];
  summary: AiSessionSummary;
}

// Get all AI sessions for a work item, scoped to workspace
export const getAiSessionsByWorkItemId = async (
  workspaceId: string,
  workItemId: string
): Promise<AiSessionDb[]> => {
  return db
    .select({
      id: aiSessions.id,
      workItemId: aiSessions.workItemId,
      agentJobId: aiSessions.agentJobId,
      model: aiSessions.model,
      provider: aiSessions.provider,
      inputTokens: aiSessions.inputTokens,
      outputTokens: aiSessions.outputTokens,
      cacheReadInputTokens: aiSessions.cacheReadInputTokens,
      cacheCreationInputTokens: aiSessions.cacheCreationInputTokens,
      totalTokens: aiSessions.totalTokens,
      estimatedCost: aiSessions.estimatedCost,
      durationMs: aiSessions.durationMs,
      sessionType: aiSessions.sessionType,
      metadata: aiSessions.metadata,
      createdAt: aiSessions.createdAt,
    })
    .from(aiSessions)
    .innerJoin(workItems, eq(aiSessions.workItemId, workItems.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        eq(aiSessions.workItemId, workItemId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(aiSessions.createdAt));
};

// Get AI sessions with aggregated summary for a work item, scoped to workspace
export const getAiSessionsSummaryByWorkItemId = async (
  workspaceId: string,
  workItemId: string
): Promise<AiSessionWithSummary> => {
  const sessions = await getAiSessionsByWorkItemId(workspaceId, workItemId);

  // Filter out "placeholder" sessions created by older agent workflows.
  // These were recorded with 0 tokens / 0 cost and an arbitrary duration, and should not affect totals.
  const visibleSessions = sessions.filter((s) => {
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    const source = meta.source;
    if (source !== "skill-inline") return true;
    if (s.inputTokens !== 0 || s.outputTokens !== 0 || s.totalTokens !== 0) return true;
    if (parseFloat(s.estimatedCost) !== 0) return true;
    return false;
  });

  const summary: AiSessionSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalEstimatedCost: "0",
    totalDurationMs: 0,
    sessionCount: visibleSessions.length,
  };

  if (visibleSessions.length > 0) {
    let costSum = 0;
    for (const s of visibleSessions) {
      summary.totalInputTokens += s.inputTokens;
      summary.totalOutputTokens += s.outputTokens;
      summary.totalTokens += s.totalTokens;
      summary.totalDurationMs += s.durationMs ?? 0;
      costSum += parseFloat(s.estimatedCost);
    }
    summary.totalEstimatedCost = costSum.toFixed(6);
  }

  return { sessions: visibleSessions, summary };
};

// Create a new AI session, verifying the work item belongs to the workspace
export const createAiSession = async (
  workspaceId: string,
  data: NewAiSession
): Promise<AiSessionDb> => {
  // Verify the work item's project belongs to the given workspace
  const [workItem] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        eq(workItems.id, data.workItemId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!workItem) {
    throw new Error("Work item not found or does not belong to workspace");
  }

  const [session] = await db.insert(aiSessions).values(data).returning();
  if (!session) throw new Error("Failed to create AI session");
  return session;
};

/**
 * Return the set of distinct work item IDs that have at least one AI session
 * recorded for the given agent job. Used by runner-implement completion gates
 * (INV-4) as the deterministic source of truth for "which tasks were
 * actually completed" — regardless of what the orchestrator's ## Summary
 * claims.
 */
export const getCompletedWorkItemIdsForJob = async (
  agentJobId: string
): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ workItemId: aiSessions.workItemId })
    .from(aiSessions)
    .where(eq(aiSessions.agentJobId, agentJobId));
  return rows.map((r) => r.workItemId);
};

// Check if a work item has any AI sessions, scoped to workspace
export const hasAiSessions = async (
  workspaceId: string,
  workItemId: string
): Promise<boolean> => {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiSessions)
    .innerJoin(workItems, eq(aiSessions.workItemId, workItems.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        eq(aiSessions.workItemId, workItemId),
        eq(projects.workspaceId, workspaceId)
      )
    );
  return (result[0]?.count ?? 0) > 0;
};
