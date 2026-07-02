import { db } from "../../client";
import {
  agentMemoryTelemetry,
  agentMemoryTelemetryHits,
} from "../../schema";

export interface CreateMemoryTelemetryInput {
  workspaceId: string;
  agentJobId?: string | null;
  event: "search" | "context" | "save" | "inject";
  query?: string | null;
  resultCount?: number | null;
  durationMs?: number | null;
  tokensInjected?: number | null;
  hits?: Array<{
    observationId: string;
    rank: number;
    score?: number | null;
    injected?: boolean;
  }>;
}

export const createMemoryTelemetry = async (
  input: CreateMemoryTelemetryInput
) => {
  return db.transaction(async (tx) => {
    const [telemetry] = await tx
      .insert(agentMemoryTelemetry)
      .values({
        workspaceId: input.workspaceId,
        agentJobId: input.agentJobId ?? null,
        event: input.event,
        query: input.query ?? null,
        resultCount: input.resultCount ?? null,
        durationMs: input.durationMs ?? null,
        tokensInjected: input.tokensInjected ?? null,
      })
      .returning();

    if (telemetry && input.hits && input.hits.length > 0) {
      await tx.insert(agentMemoryTelemetryHits).values(
        input.hits.map((hit) => ({
          telemetryId: telemetry.id,
          observationId: hit.observationId,
          rank: hit.rank,
          score:
            hit.score == null
              ? null
              : Math.min(9.9999, Math.max(0, hit.score)).toFixed(4),
          injected: hit.injected ?? false,
        }))
      );
    }

    return telemetry!;
  });
};
