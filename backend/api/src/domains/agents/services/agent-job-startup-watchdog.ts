export type PreSessionStartupSnapshot = {
  status: string;
  sessionId: string | null;
  startedAt: Date | null;
  lastServeReadyAt: Date | null;
  hasSessionCreatedLog: boolean;
};

export const isPreSessionStartupStuck = (
  snapshot: PreSessionStartupSnapshot,
  now: Date,
  timeoutMs: number,
): boolean => {
  if (snapshot.status !== "running") return false;
  if (snapshot.sessionId) return false;
  if (!snapshot.startedAt || !snapshot.lastServeReadyAt) return false;
  if (snapshot.hasSessionCreatedLog) return false;

  return now.getTime() - snapshot.lastServeReadyAt.getTime() > timeoutMs;
};
