/**
 * Higher-order function that wraps a reducer to capture state transitions
 * in the trace sink (dev-only, gated by NEXT_PUBLIC_DEBUG_TRACE=1).
 */

import { traceSink } from "./trace-sink";
import { computePlanningDiff } from "./planning-transition-diff";

type AnyReducer<S, A> = (state: S, action: A) => S;

// Shape we require from planning state and action for diffing
interface DiffableState {
  phase: string;
  sessionId: string | null;
  pendingQuestion: { questionId?: string; id?: string } | null;
  messages: unknown[];
  completedTurnBlocks: unknown[][];
}

interface DiffableAction {
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

const isActive = (): boolean =>
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_DEBUG_TRACE === "1";

/**
 * Wraps a planning reducer to push transition diffs to the trace sink.
 * Returns the original reducer unchanged when the flag is off — zero overhead.
 */
export const withTraceSinkReducer = <S extends DiffableState, A extends DiffableAction>(
  reducer: AnyReducer<S, A>
): AnyReducer<S, A> => {
  if (!isActive()) return reducer;

  return (state: S, action: A): S => {
    const nextState = reducer(state, action);
    try {
      const meta = computePlanningDiff(state, nextState, action);
      traceSink.push({
        t: Date.now(),
        kind: "reducer",
        label: action.type,
        sessionId: nextState.sessionId ?? undefined,
        meta,
      });
    } catch {
      // Never let tracing break the app
    }
    return nextState;
  };
};
