import {
  cancelInteractionsByJobId,
  cancelJob,
  completePlanningSession,
  getActiveJobForPlanningSession,
  getActivePlanningSessions,
  hasAnyJobForPlanningSession,
  interruptPlanningSession,
  getWorkItemsBySession,
  getSeedsBySession,
  db,
  planningSessions,
  and,
  eq,
  lt,
} from "@almirant/database";
import type { InterruptionContext } from "@almirant/database";
import { logger } from "@almirant/config";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";

type PlanningSessionIdleSweeperConfig = {
  intervalMs?: number;
};

type SessionPhase = "agent_running" | "queued" | "waiting_for_input" | "awaiting_user" | "idle";

const IDLE_TIMEOUTS: Record<SessionPhase, number> = {
  agent_running: Infinity,
  queued: Infinity,
  waiting_for_input: 30 * 60_000,
  awaiting_user: 30 * 60_000,
  idle: 10 * 60_000,
} as const;

const handleInactiveSession = async (
  sessionId: string,
  organizationId: string,
  phase: SessionPhase,
  hasJobs: boolean
) => {
  // Sessions with history -> interrupted (can be resumed)
  if (hasJobs) {
    const sessionWorkItems = await getWorkItemsBySession(sessionId);
    const sessionSeeds = await getSeedsBySession(sessionId);

    const context: InterruptionContext = {
      reason: "idle_timeout",
      lastPhase: phase,
      workItemsCreatedSoFar: sessionWorkItems.length,
      seedsProcessedSoFar: sessionSeeds.length,
      lastJobId: "",
      interruptedAt: new Date().toISOString(),
    };

    const interrupted = await interruptPlanningSession(sessionId, context);
    if (!interrupted) return;

    wsConnectionManager.broadcastToOrganization(organizationId, {
      type: "planning-session:interrupted" as any,
      payload: {
        sessionId,
        reason: "idle_timeout",
        workItemsCreated: sessionWorkItems.length,
      },
    });

    logger.info(
      { planningSessionId: sessionId, phase },
      "Planning session idle sweeper: interrupted session with history"
    );
    return;
  }

  // Sessions without history -> completed (abandoned)
  const completed = await completePlanningSession(sessionId, {
    summary: `Planning session closed due to inactivity (phase: ${phase})`,
    reason: "idle_timeout",
  });

  if (!completed) return;

  wsConnectionManager.broadcastToOrganization(organizationId, {
    type: "planning-session:completed",
    payload: {
      sessionId,
      result: completed.result ?? {},
    },
  });
};

export const runPlanningSessionIdleSweepOnce = async (
  _cfg?: PlanningSessionIdleSweeperConfig
): Promise<void> => {
  const sessions = await getActivePlanningSessions();

  for (const session of sessions) {
    try {
      const activeJob = await getActiveJobForPlanningSession(session.id);

      let phase: SessionPhase;

      if (activeJob?.status === "running" || activeJob?.status === "finalizing") {
        phase = "agent_running";
      } else if (activeJob?.status === "queued") {
        phase = "queued";
      } else if (activeJob?.status === "waiting_for_input" || activeJob?.status === "paused") {
        phase = "waiting_for_input";
      } else {
        const hasJobs = await hasAnyJobForPlanningSession(session.id);
        phase = hasJobs ? "awaiting_user" : "idle";
      }

      const timeout = IDLE_TIMEOUTS[phase];
      if (timeout === Infinity) continue;

      const elapsed = Date.now() - session.updatedAt.getTime();
      if (elapsed < timeout) continue;

      if (phase === "waiting_for_input" && activeJob) {
        await cancelInteractionsByJobId(activeJob.id);
        const cancelled = await cancelJob(activeJob.id);

        if (cancelled) {
          wsConnectionManager.broadcastToOrganization(session.organizationId, {
            type: "agent-job:status-changed",
            payload: {
              jobId: cancelled.id,
              status: cancelled.status,
              workItemId: cancelled.workItemId ?? null,
              planningSessionId: cancelled.planningSessionId ?? null,
            },
          });
        }
      }

      // Determine if session has job history:
      // - If activeJob existed (waiting_for_input phase) -> has jobs
      // - If phase is awaiting_user -> hasAnyJobForPlanningSession was true
      // - If phase is idle -> no jobs
      const sessionHasJobs = phase !== "idle";

      await handleInactiveSession(session.id, session.organizationId, phase, sessionHasJobs);
    } catch (err) {
      logger.error(
        { err, planningSessionId: session.id },
        "Planning session idle sweeper: failed to close inactive session"
      );
    }
  }

  // Second pass: auto-complete sessions interrupted for >24h
  try {
    const interruptedCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const interruptedSessions = await db
      .select({
        id: planningSessions.id,
        organizationId: planningSessions.organizationId,
      })
      .from(planningSessions)
      .where(
        and(
          eq(planningSessions.status, "interrupted"),
          lt(planningSessions.updatedAt, interruptedCutoff)
        )
      );

    for (const session of interruptedSessions) {
      try {
        const completed = await completePlanningSession(session.id, {
          summary: "Planning session auto-completed after being interrupted for 24+ hours",
          reason: "auto_completed_after_interruption",
        });

        if (completed) {
          wsConnectionManager.broadcastToOrganization(session.organizationId, {
            type: "planning-session:completed",
            payload: {
              sessionId: session.id,
              result: completed.result ?? {},
            },
          });
          logger.info(
            { planningSessionId: session.id },
            "Planning session idle sweeper: auto-completed interrupted session (>24h)"
          );
        }
      } catch (err) {
        logger.error(
          { err, planningSessionId: session.id },
          "Planning session idle sweeper: failed to auto-complete interrupted session"
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Planning session idle sweeper: interrupted 24h sweep failed");
  }
};

export const startPlanningSessionIdleSweeper = (
  cfg?: PlanningSessionIdleSweeperConfig
): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 60_000;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runPlanningSessionIdleSweepOnce(cfg);
    } catch (err) {
      logger.error(
        { err },
        "Planning session idle sweeper: tick failed (transient error, will retry)"
      );
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
