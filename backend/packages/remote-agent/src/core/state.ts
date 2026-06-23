export enum SessionState {
  IDLE = "IDLE",
  PENDING = "PENDING",
  STARTING = "STARTING",
  ACTIVE = "ACTIVE",
  STAGNANT = "STAGNANT",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export const SESSION_STATE_TRANSITIONS: Record<SessionState, SessionState[]> = {
  [SessionState.IDLE]: [
    SessionState.PENDING,
    SessionState.STARTING,
    SessionState.ACTIVE,
    SessionState.FAILED,
    SessionState.CANCELLED,
  ],
  [SessionState.PENDING]: [
    SessionState.STARTING,
    SessionState.CANCELLED,
    SessionState.FAILED,
  ],
  [SessionState.STARTING]: [
    SessionState.ACTIVE,
    SessionState.STAGNANT,
    SessionState.CANCELLED,
    SessionState.FAILED,
  ],
  [SessionState.ACTIVE]: [
    SessionState.STAGNANT,
    SessionState.COMPLETED,
    SessionState.CANCELLED,
    SessionState.FAILED,
  ],
  [SessionState.STAGNANT]: [
    SessionState.ACTIVE,
    SessionState.COMPLETED,
    SessionState.CANCELLED,
    SessionState.FAILED,
  ],
  [SessionState.COMPLETED]: [],
  [SessionState.FAILED]: [],
  [SessionState.CANCELLED]: [],
};

export const canTransitionSessionState = (
  current: SessionState,
  next: SessionState
): boolean => SESSION_STATE_TRANSITIONS[current].includes(next);

export const transitionSessionState = (
  current: SessionState,
  next: SessionState
): SessionState => {
  if (!canTransitionSessionState(current, next)) {
    throw new Error(`Invalid SessionState transition: ${current} -> ${next}`);
  }
  return next;
};

export const isTerminalSessionState = (state: SessionState): boolean => {
  return (
    state === SessionState.COMPLETED ||
    state === SessionState.FAILED ||
    state === SessionState.CANCELLED
  );
};
