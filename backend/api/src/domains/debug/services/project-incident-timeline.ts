/**
 * Pure function that projects a flat, time-ordered timeline from an IncidentBundleData.
 * No DB calls. No side effects. Deterministic. On-demand only.
 *
 * Dedupe rule: if the same tool_call appears in both session_events and agent_job_logs,
 * session_events is canonical and the job-log entry is dropped.
 *
 * Ported verbatim from the enterprise debug domain — the projector depends only
 * on the `IncidentBundleData` shape which is identical in cloud.
 */

import type { IncidentBundleData } from "@almirant/database";

const TIMELINE_CAP = 800;

export type IncidentTimelineEntry = {
  t: number;
  source: "frontend-trace" | "session-event" | "job-log" | "error-memory" | "feedback";
  kind: string;
  actor: "user" | "backend" | "runner" | "ai" | "system";
  summary: string;
  refs: {
    jobId?: string;
    sessionId?: string;
    traceId?: string;
    sequenceNum?: number;
  };
  raw?: Record<string, unknown>;
};

export type IncidentTimeline = {
  version: 1;
  bundleId: string;
  entries: IncidentTimelineEntry[];
  truncated: boolean;
};

// --- Mapping helpers ---

const actorFromKind = (kind: string, source: IncidentTimelineEntry["source"]): IncidentTimelineEntry["actor"] => {
  if (source === "frontend-trace") {
    const k = kind.toLowerCase();
    if (k === "ws-out" || k === "reducer") return "user";
    if (k === "ws-in") return "backend";
    return "user";
  }
  if (source === "session-event") {
    const k = kind.toLowerCase();
    if (k.includes("tool_call") || k.includes("bash") || k.includes("file")) return "ai";
    if (k.includes("user_input")) return "user";
    return "runner";
  }
  if (source === "job-log") {
    const phase = kind.split(":")[0] ?? "";
    if (phase === "transcript") return "ai";
    return "runner";
  }
  if (source === "error-memory") return "system";
  if (source === "feedback") return "user";
  return "system";
};

const summarize = (entry: IncidentTimelineEntry): string => {
  const { source, kind, refs } = entry;
  if (source === "frontend-trace") {
    if (kind === "ws-out") return `User sent: ${(entry.raw as Record<string, unknown>)?.label ?? kind}`;
    if (kind === "ws-in") return `WS frame received: ${(entry.raw as Record<string, unknown>)?.label ?? kind}`;
    if (kind === "reducer") {
      const meta = entry.raw as Record<string, unknown> | undefined;
      const prev = meta?.prevPhase as string | undefined;
      const next = meta?.nextPhase as string | undefined;
      if (prev && next && prev !== next) return `State: ${prev} → ${next}`;
      return `Reducer: ${kind}`;
    }
    return kind;
  }
  if (source === "session-event") return `Event[${refs.sequenceNum}]: ${kind}`;
  if (source === "job-log") return `Log: ${kind}`;
  if (source === "error-memory") return `Error memory: ${(entry.raw as Record<string, unknown>)?.title ?? kind}`;
  if (source === "feedback") return `Feedback submitted: ${(entry.raw as Record<string, unknown>)?.title ?? ""}`;
  return kind;
};

// --- Main projector ---

export const projectIncidentTimeline = (
  bundle: IncidentBundleData,
  bundleId: string
): IncidentTimeline => {
  const entries: IncidentTimelineEntry[] = [];

  // Track tool_call sequenceNums seen in session_events to dedupe job-logs
  const toolCallSeqNums = new Set<number>();

  // 1. Feedback submitted
  if (bundle.feedback) {
    const t = new Date(bundle.feedback.createdAt).getTime();
    entries.push({
      t,
      source: "feedback",
      kind: "feedback:submitted",
      actor: "user",
      summary: `Feedback submitted: ${bundle.feedback.title}`,
      refs: {},
      raw: { title: bundle.feedback.title, category: bundle.feedback.category },
    });
  }

  // 2. Session events (canonical)
  const jobId = bundle.job?.id;
  for (const ev of bundle.sessionEvents) {
    const t = new Date(ev.createdAt).getTime();
    const isToolCall = ev.kind.includes("tool_call");
    if (isToolCall) toolCallSeqNums.add(ev.sequenceNum);

    const entry: IncidentTimelineEntry = {
      t,
      source: "session-event",
      kind: ev.kind,
      actor: actorFromKind(ev.kind, "session-event"),
      summary: "",
      refs: {
        jobId,
        sequenceNum: ev.sequenceNum,
        traceId: (bundle.job?.config as Record<string, unknown>)?.traceId as string | undefined,
      },
      raw: ev.payload,
    };
    entry.summary = summarize(entry);
    entries.push(entry);
  }

  // 3. Job logs — skip entries that duplicate session_events tool_calls
  for (const log of bundle.jobLogs) {
    const t = new Date(log.createdAt).getTime();
    const isToolCall =
      log.eventType.includes("tool_call") || log.phase.includes("tool_call");
    const seqNum = (log.payload as Record<string, unknown>)?.sequenceNum as number | undefined;
    if (isToolCall && seqNum !== undefined && toolCallSeqNums.has(seqNum)) {
      continue; // dedupe: session-event is canonical
    }

    const kind = `${log.phase}:${log.eventType}`;
    const entry: IncidentTimelineEntry = {
      t,
      source: "job-log",
      kind,
      actor: actorFromKind(kind, "job-log"),
      summary: "",
      refs: { jobId },
      raw: log.payload,
    };
    entry.summary = summarize(entry);
    entries.push(entry);
  }

  // 4. Frontend trace sink
  if (bundle.frontendTrace) {
    for (const item of bundle.frontendTrace) {
      const entry: IncidentTimelineEntry = {
        t: item.t,
        source: "frontend-trace",
        kind: item.kind,
        actor: actorFromKind(item.kind, "frontend-trace"),
        summary: "",
        refs: {
          jobId: item.jobId,
          traceId: item.traceId,
        },
        raw: { label: item.label, ...((item.meta as Record<string, unknown>) ?? {}) },
      };
      entry.summary = summarize(entry);
      entries.push(entry);
    }
  }

  // 5. Error memory (pinned at the end, no specific timestamp — use bundle creation)
  const feedbackCreatedAt = bundle.feedback
    ? new Date(bundle.feedback.createdAt).getTime()
    : Date.now();

  for (const obs of bundle.errorMemory) {
    const entry: IncidentTimelineEntry = {
      t: feedbackCreatedAt,
      source: "error-memory",
      kind: obs.type,
      actor: "system",
      summary: "",
      refs: {},
      raw: { title: obs.title, topicKey: obs.topicKey },
    };
    entry.summary = summarize(entry);
    entries.push(entry);
  }

  // Sort by time ASC
  entries.sort((a, b) => a.t - b.t);

  const truncated = entries.length > TIMELINE_CAP;
  const cappedEntries = truncated ? entries.slice(0, TIMELINE_CAP) : entries;

  return {
    version: 1,
    bundleId,
    entries: cappedEntries,
    truncated,
  };
};
