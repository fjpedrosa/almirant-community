/**
 * Pure function to compute the diff of a planning reducer transition.
 * Extracted from with-trace-sink-reducer for isolated testing.
 */

import type { PlanningReducerTransitionMeta } from "./trace-sink";

// Minimal shape we need from state — avoids importing the full PlanningSessionState
interface MinimalPlanningState {
  phase: string;
  sessionId: string | null;
  pendingQuestion: { questionId?: string; id?: string } | null;
  messages: unknown[];
  completedTurnBlocks: unknown[][];
}

// Minimal action shape — avoids importing the full PlanningAction union
interface MinimalPlanningAction {
  type: string;
  payload?: {
    jobId?: string;
    traceId?: string;
    sequenceNum?: number;
    [key: string]: unknown;
  };
  jobId?: string;
  traceId?: string;
  sequenceNum?: number;
}

export const computePlanningDiff = (
  prev: MinimalPlanningState,
  next: MinimalPlanningState,
  action: MinimalPlanningAction
): PlanningReducerTransitionMeta => {
  const prevPendingQuestionId =
    prev.pendingQuestion?.questionId ?? prev.pendingQuestion?.id ?? null;
  const nextPendingQuestionId =
    next.pendingQuestion?.questionId ?? next.pendingQuestion?.id ?? null;

  const actionRefs: PlanningReducerTransitionMeta["actionRefs"] = {};
  const jobId =
    action.payload?.jobId ?? action.jobId;
  const traceId =
    action.payload?.traceId ?? action.traceId;
  const sequenceNum =
    action.payload?.sequenceNum ?? action.sequenceNum;

  if (jobId !== undefined) actionRefs.jobId = String(jobId);
  if (traceId !== undefined) actionRefs.traceId = String(traceId);
  if (sequenceNum !== undefined) actionRefs.sequenceNum = Number(sequenceNum);

  return {
    prevPhase: prev.phase,
    nextPhase: next.phase,
    phaseChanged: prev.phase !== next.phase,
    prevPendingQuestionId,
    nextPendingQuestionId,
    pendingQuestionChanged: prevPendingQuestionId !== nextPendingQuestionId,
    sessionId: next.sessionId,
    messagesCount: next.messages.length,
    turnBlocksCount: next.completedTurnBlocks.length,
    ...(Object.keys(actionRefs).length > 0 ? { actionRefs } : {}),
  };
};
