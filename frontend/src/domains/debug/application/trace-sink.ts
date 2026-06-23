/**
 * Dev-only ring buffer trace sink for planning reducer transitions and WS frames.
 * Only active when NEXT_PUBLIC_DEBUG_TRACE=1 is set.
 */

export type PlanningReducerTransitionMeta = {
  prevPhase: string;
  nextPhase: string;
  phaseChanged: boolean;
  prevPendingQuestionId: string | null;
  nextPendingQuestionId: string | null;
  pendingQuestionChanged: boolean;
  sessionId: string | null;
  messagesCount: number;
  turnBlocksCount: number;
  actionRefs?: { jobId?: string; traceId?: string; sequenceNum?: number };
};

export type WsInboundMeta = {
  hasSubscriber: boolean;
};

export type WsOutboundMeta = {
  readyState: number | undefined;
  clientActionId?: string;
  traceId?: string;
};

export type TraceSinkMeta =
  | PlanningReducerTransitionMeta
  | WsInboundMeta
  | WsOutboundMeta
  | Record<string, unknown>;

export type TraceSinkEntry = {
  t: number;
  kind: "reducer" | "ws-in" | "ws-out" | "nav" | "error";
  label: string;
  traceId?: string;
  jobId?: string;
  sessionId?: string;
  meta?: TraceSinkMeta;
};

const MAX_ENTRIES = 500;
const isActive = (): boolean =>
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_DEBUG_TRACE === "1";

let buffer: TraceSinkEntry[] = [];

const push = (entry: TraceSinkEntry): void => {
  if (!isActive()) return;
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(buffer.length - MAX_ENTRIES);
  }
};

const snapshot = (): TraceSinkEntry[] => {
  if (!isActive()) return [];
  return [...buffer];
};

const clear = (): void => {
  buffer = [];
};

export const traceSink = { push, snapshot, clear };
