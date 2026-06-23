import type { AgentJobDb, SessionEventDb, WorkerMetricsHistoryDb } from "@almirant/database";
import type { ResourceConfidence, ResourceEstimate } from "@almirant/shared";

export type ResourceTimelineSample = {
  timestamp: string;
  ramUsedMb: number;
  ramTotalMb: number | null;
  containerMemoryMb: number | null;
  estimatedMemoryMb: number | null;
  activeSubagents: number;
  activeSubagentTypes: string[];
  activeWave: number | null;
};

export type ResourceTimelineAgent = {
  subagentId: string;
  subagentType: string;
  description: string | null;
  startedAt: string;
  completedAt: string | null;
  success: boolean | null;
};

export type ResourceTimelineTaskSummary = {
  jobId: string;
  workItemId: string | null;
  skillName: string | null;
  peakRamMb: number | null;
  averageRamMb: number | null;
  maxSubagents: number;
  forecastMemoryMb: number | null;
  forecastDeltaMb: number | null;
};

export type ResourceTimeline = {
  jobId: string;
  workerId: string | null;
  forecast: ResourceEstimate | null;
  samples: ResourceTimelineSample[];
  agents: ResourceTimelineAgent[];
  summary: ResourceTimelineTaskSummary;
};

export type SubagentMemoryProfile = {
  subagentType: string;
  p50MemoryDeltaMb: number;
  p95MemoryDeltaMb: number;
  peakObservedMb: number;
  sampleCount: number;
  confidence: ResourceConfidence;
};

type SessionEventLike = Pick<SessionEventDb, "kind" | "payload" | "createdAt">;
type MetricsLike = Pick<WorkerMetricsHistoryDb, "timestamp" | "ramUsedMb" | "ramTotalMb" | "containerMetrics">;

type AgentInterval = ResourceTimelineAgent & {
  startMs: number;
  endMs: number | null;
};

type WaveInterval = {
  wave: number;
  startMs: number;
  endMs: number | null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const toString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toNumber = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toMs = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
};

const confidenceForSamples = (count: number): ResourceConfidence => {
  if (count >= 30) return "high";
  if (count >= 10) return "medium";
  return "low";
};

const TASK_ID_PATTERN = /\b[A-Z][A-Z0-9]*-\d+\b/g;

const extractTaskIds = (text: string): Set<string> =>
  new Set((text.match(TASK_ID_PATTERN) ?? []).map((id) => id.toUpperCase()));

const getIntervalTaskId = (interval: Pick<AgentInterval, "description">): string | null =>
  interval.description?.match(TASK_ID_PATTERN)?.[0]?.toUpperCase() ?? null;

const extractTerminalTaskResultsFromProgressText = (text: string): Map<string, boolean> => {
  const terminalTaskResults = new Map<string, boolean>();
  const successPatterns = [
    /\b([A-Z][A-Z0-9]*-\d+)\b[\s\S]{0,180}?\bcompleted successfully\b/gi,
    /\b([A-Z][A-Z0-9]*-\d+)\b[\s\S]{0,180}?\bcompleted\s*->\s*To Review\b/gi,
    /\b([A-Z][A-Z0-9]*-\d+)\|SUCCESS\b/gi,
    /\b([A-Z][A-Z0-9]*-\d+)\b[\s\S]{0,180}?\bmovid[ao]\s+a\s+"?To Review"?\b/gi,
  ];
  const failurePatterns = [
    /\b([A-Z][A-Z0-9]*-\d+)\|FAILED\b/gi,
    /\b([A-Z][A-Z0-9]*-\d+)\b[\s\S]{0,180}?\bfailed\b/gi,
  ];

  for (const pattern of successPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) terminalTaskResults.set(match[1].toUpperCase(), true);
    }
  }

  for (const pattern of failurePatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) terminalTaskResults.set(match[1].toUpperCase(), false);
    }
  }

  return terminalTaskResults;
};

const extractRemainingTaskIdsFromProgressText = (text: string): Set<string> => {
  const remainingTaskIds = new Set<string>();
  const remainingPatterns = [
    /\bwaiting for\s+([\s\S]{0,160}?)\s+to complete\b/gi,
    /\bwaiting for\s+([\s\S]{0,160}?)\./gi,
    /\bonly\s+([A-Z][A-Z0-9]*-\d+)\s+is left\b/gi,
  ];

  for (const pattern of remainingPatterns) {
    for (const match of text.matchAll(pattern)) {
      const ids = extractTaskIds(match[1] ?? "");
      for (const id of ids) remainingTaskIds.add(id);
    }
  }

  return remainingTaskIds;
};

const completeInterval = (interval: AgentInterval, event: SessionEventLike, success = true): void => {
  interval.completedAt = toIso(event.createdAt);
  interval.endMs = toMs(event.createdAt);
  interval.success = success;
};

const markBackgroundSubagentIntervalsDoneByTaskResults = (
  intervals: Map<string, AgentInterval>,
  event: SessionEventLike,
  taskResults: Map<string, boolean>,
): void => {
  if (taskResults.size === 0) return;

  for (const interval of intervals.values()) {
    if (interval.endMs !== null) continue;
    const taskId = getIntervalTaskId(interval);
    const success = taskId ? taskResults.get(taskId) : undefined;
    if (success === undefined) continue;
    completeInterval(interval, event, success);
  }
};

const markBackgroundSubagentIntervalsDoneExceptRemaining = (
  intervals: Map<string, AgentInterval>,
  event: SessionEventLike,
  remainingTaskIds: Set<string>,
): void => {
  if (remainingTaskIds.size === 0) return;

  for (const interval of intervals.values()) {
    if (interval.endMs !== null) continue;
    const taskId = getIntervalTaskId(interval);
    if (!taskId || remainingTaskIds.has(taskId)) continue;
    completeInterval(interval, event);
  }
};

const applyTextualSubagentProgress = (
  intervals: Map<string, AgentInterval>,
  event: SessionEventLike,
  textBuffer: string,
): void => {
  markBackgroundSubagentIntervalsDoneByTaskResults(
    intervals,
    event,
    extractTerminalTaskResultsFromProgressText(textBuffer),
  );
  markBackgroundSubagentIntervalsDoneExceptRemaining(
    intervals,
    event,
    extractRemainingTaskIdsFromProgressText(textBuffer),
  );
};

export const buildSubagentIntervals = (events: SessionEventLike[]): AgentInterval[] => {
  const intervals = new Map<string, AgentInterval>();
  let textBuffer = "";
  let lastTextEventMs: number | null = null;

  for (const event of [...events].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))) {
    const payload = toRecord(event.payload);
    if (event.kind === "agent.text") {
      const eventMs = toMs(event.createdAt);
      if (lastTextEventMs !== null && eventMs - lastTextEventMs > 2000) {
        textBuffer = "";
      }
      textBuffer = `${textBuffer}${toString(payload.content) ?? ""}`.slice(-1000);
      lastTextEventMs = eventMs;
      applyTextualSubagentProgress(intervals, event, textBuffer);
    }
    if (event.kind === "agent.text.complete") {
      const eventMs = toMs(event.createdAt);
      if (lastTextEventMs !== null && eventMs - lastTextEventMs > 2000) {
        textBuffer = "";
      }
      textBuffer = (toString(payload.fullText) ?? textBuffer).slice(-1000);
      lastTextEventMs = eventMs;
      applyTextualSubagentProgress(intervals, event, textBuffer);
    }
    if (event.kind === "agent.subagent.spawn") {
      const subagentId = toString(payload.subagentId);
      if (!subagentId) continue;
      const subagentType = toString(payload.subagentType) ?? "general-purpose";
      const description = toString(payload.description);
      const existing = intervals.get(subagentId);
      if (existing) {
        // OpenCode can replay/enrich the same tool/subagent snapshot more than once.
        // Treat repeated spawns for the same id as metadata updates, not as a new
        // interval, otherwise a late duplicate spawn overwrites the real start time
        // and collapses the agent duration to zero.
        if (subagentType !== "general-purpose") existing.subagentType = subagentType;
        if (description) existing.description = description;
        continue;
      }
      intervals.set(subagentId, {
        subagentId,
        subagentType,
        description,
        startedAt: toIso(event.createdAt),
        completedAt: null,
        success: null,
        startMs: toMs(event.createdAt),
        endMs: null,
      });
    }

    if (event.kind === "agent.subagent.complete") {
      const subagentId = toString(payload.subagentId);
      if (!subagentId) continue;
      const existing = intervals.get(subagentId);
      if (!existing) continue;
      if (existing.endMs !== null) continue;
      existing.completedAt = toIso(event.createdAt);
      existing.endMs = toMs(event.createdAt);
      existing.success = payload.success !== false;
    }
  }

  return [...intervals.values()];
};

const buildWaveIntervals = (events: SessionEventLike[]): WaveInterval[] => {
  const waves: WaveInterval[] = [];
  let current: WaveInterval | null = null;
  let waveNumber = 0;

  for (const event of [...events].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))) {
    if (event.kind === "agent.wave.start") {
      if (current && current.endMs === null) current.endMs = toMs(event.createdAt);
      waveNumber += 1;
      current = { wave: waveNumber, startMs: toMs(event.createdAt), endMs: null };
      waves.push(current);
    }
    if (event.kind === "agent.wave.end" && current && current.endMs === null) {
      current.endMs = toMs(event.createdAt);
      current = null;
    }
  }

  return waves;
};

const extractContainerMemoryMb = (containerMetrics: unknown, jobId: string): number | null => {
  if (!Array.isArray(containerMetrics)) return null;
  for (const entry of containerMetrics) {
    const record = toRecord(entry);
    if (record.jobId === jobId) {
      return toNumber(record.memoryUsageMb);
    }
  }
  return null;
};

const activeIntervalsAt = (intervals: AgentInterval[], timestampMs: number): AgentInterval[] =>
  intervals.filter((interval) =>
    interval.startMs <= timestampMs && (interval.endMs === null || interval.endMs >= timestampMs)
  );

const activeWaveAt = (waves: WaveInterval[], timestampMs: number): number | null =>
  waves.find((wave) => wave.startMs <= timestampMs && (wave.endMs === null || wave.endMs >= timestampMs))?.wave ?? null;

export const buildResourceTimeline = (
  job: Pick<AgentJobDb, "id" | "workerId" | "workItemId" | "config">,
  metrics: MetricsLike[],
  events: SessionEventLike[],
): ResourceTimeline => {
  const agents = buildSubagentIntervals(events);
  const waves = buildWaveIntervals(events);
  const forecast = (toRecord(job.config).resourceEstimate ?? null) as ResourceEstimate | null;
  const estimatedMemoryMb = forecast?.estimatedMemoryMb ?? null;

  const samples = [...metrics]
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
    .map<ResourceTimelineSample>((metric) => {
      const timestampMs = toMs(metric.timestamp);
      const activeAgents = activeIntervalsAt(agents, timestampMs);
      const containerMemoryMb = extractContainerMemoryMb(metric.containerMetrics, job.id);
      const ramUsedMb = containerMemoryMb ?? metric.ramUsedMb ?? 0;
      return {
        timestamp: toIso(metric.timestamp),
        ramUsedMb,
        ramTotalMb: metric.ramTotalMb ?? null,
        containerMemoryMb,
        estimatedMemoryMb,
        activeSubagents: activeAgents.length,
        activeSubagentTypes: Array.from(new Set(activeAgents.map((agent) => agent.subagentType))).sort(),
        activeWave: activeWaveAt(waves, timestampMs),
      };
    });

  const peakRamMb = samples.length > 0 ? Math.max(...samples.map((sample) => sample.ramUsedMb)) : null;
  const averageRamMb = samples.length > 0
    ? Math.round(samples.reduce((sum, sample) => sum + sample.ramUsedMb, 0) / samples.length)
    : null;

  return {
    jobId: job.id,
    workerId: job.workerId ?? null,
    forecast,
    samples,
    agents: agents.map(({ startMs: _startMs, endMs: _endMs, ...agent }) => agent),
    summary: {
      jobId: job.id,
      workItemId: job.workItemId ?? null,
      skillName: toString(toRecord(job.config).skillName),
      peakRamMb,
      averageRamMb,
      maxSubagents: samples.length > 0 ? Math.max(...samples.map((sample) => sample.activeSubagents)) : 0,
      forecastMemoryMb: estimatedMemoryMb,
      forecastDeltaMb: peakRamMb !== null && estimatedMemoryMb !== null ? peakRamMb - estimatedMemoryMb : null,
    },
  };
};

export const buildSubagentMemoryProfiles = (timelines: ResourceTimeline[]): SubagentMemoryProfile[] => {
  const deltasByType = new Map<string, number[]>();

  for (const timeline of timelines) {
    if (timeline.samples.length === 0) continue;
    const baseline = Math.min(...timeline.samples.map((sample) => sample.ramUsedMb));
    for (const agent of timeline.agents) {
      const startMs = new Date(agent.startedAt).getTime();
      const endMs = agent.completedAt ? new Date(agent.completedAt).getTime() : Number.POSITIVE_INFINITY;
      const samples = timeline.samples.filter((sample) => {
        const sampleMs = new Date(sample.timestamp).getTime();
        return sampleMs >= startMs && sampleMs <= endMs;
      });
      if (samples.length === 0) continue;
      const peak = Math.max(...samples.map((sample) => sample.ramUsedMb));
      const delta = Math.max(0, Math.round(peak - baseline));
      const list = deltasByType.get(agent.subagentType) ?? [];
      list.push(delta);
      deltasByType.set(agent.subagentType, list);
    }
  }

  return [...deltasByType.entries()]
    .map(([subagentType, deltas]) => ({
      subagentType,
      p50MemoryDeltaMb: percentile(deltas, 0.5),
      p95MemoryDeltaMb: percentile(deltas, 0.95),
      peakObservedMb: Math.max(...deltas),
      sampleCount: deltas.length,
      confidence: confidenceForSamples(deltas.length),
    }))
    .sort((left, right) => right.p95MemoryDeltaMb - left.p95MemoryDeltaMb);
};
