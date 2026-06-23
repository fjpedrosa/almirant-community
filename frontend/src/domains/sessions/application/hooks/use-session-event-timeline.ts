"use client";

import { useMemo } from "react";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { AgentJobType } from "@/domains/agents/domain/types";
import type { TimelinePhase } from "../../domain/types";

type TimelineGroup = {
  id: string;
  label: string;
  sourcePhases: string[];
};

type WaveTimelineInfo = {
  waveNumber: number;
  taskCount?: number;
  status: TimelinePhase["status"];
  startedAt: string | null;
  eventCount: number;
};

const SHARED_PREPARATION_PHASES = [
  "setup",
  "config",
  "context",
  "workspace",
  "serve",
  "skills",
] as const;

const SHARED_EXECUTION_PHASES = [
  "session",
  "transcript",
  "analysis",
  "implementation",
  "testing",
  "review",
  "report",
  "research",
  "brainstorming",
  "structuring",
  "creation",
  "diagnosis",
  "fix",
  "recording",
  "processing",
  "completion",
] as const;

const GIT_PHASES = ["git", "commit", "push", "pr"] as const;
const FINISH_PHASES = ["finish", "resources"] as const;

const PHASE_LABELS: Record<string, string> = {
  claim: "Claim",
  setup: "Setup",
  config: "Config",
  context: "Context",
  workspace: "Workspace",
  serve: "Serve",
  skills: "Skills",
  session: "Session",
  transcript: "Transcript",
  analysis: "Analysis",
  implementation: "Implementation",
  testing: "Testing",
  review: "Review",
  report: "Report",
  research: "Research",
  brainstorming: "Brainstorming",
  structuring: "Structuring",
  creation: "Creation",
  diagnosis: "Diagnosis",
  fix: "Fix",
  recording: "Recording",
  processing: "Processing",
  completion: "Completion",
  git: "Git",
  commit: "Commit",
  push: "Push",
  pr: "PR",
  finish: "Finish",
  resources: "Resources",
};

const getExecutionLabel = (jobType: AgentJobType | string | undefined): string => {
  switch (jobType) {
    case "planning":
      return "Planning";
    case "validation":
      return "Validation";
    case "review":
      return "Review";
    case "bug-fix":
      return "Fix";
    case "recording":
      return "Recording";
    default:
      return "Execution";
  }
};

const getGitLabel = (jobType: AgentJobType | string | undefined): string => {
  switch (jobType) {
    case "implementation":
    case "validation":
    case "review":
    case "bug-fix":
      return "Commit & PR";
    default:
      return "Git";
  }
};

const getTimelineGroups = (
  jobType: AgentJobType | string | undefined,
): TimelineGroup[] => {
  return [
    { id: "claim", label: "Claim", sourcePhases: ["claim"] },
    {
      id: "prepare",
      label: "Prepare",
      sourcePhases: [...SHARED_PREPARATION_PHASES],
    },
    {
      id: "execute",
      label: getExecutionLabel(jobType),
      sourcePhases: [...SHARED_EXECUTION_PHASES],
    },
    { id: "git", label: getGitLabel(jobType), sourcePhases: [...GIT_PHASES] },
    { id: "finish", label: "Finish", sourcePhases: [...FINISH_PHASES] },
  ];
};

const formatPhaseLabel = (phase: string): string => {
  return PHASE_LABELS[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1);
};

const getEarliestTimestamp = (chunks: AgentLogChunk[]): string | null => {
  if (chunks.length === 0) return null;

  return chunks.reduce(
    (earliest, chunk) => (chunk.timestamp < earliest ? chunk.timestamp : earliest),
    chunks[0].timestamp,
  );
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const updateWaveStatus = (
  current: TimelinePhase["status"],
  next: TimelinePhase["status"],
): TimelinePhase["status"] => {
  if (current === "done" || next === "done") return "done";
  if (current === "active" || next === "active") return "active";
  return "pending";
};

const setWaveStartedAt = (
  wave: WaveTimelineInfo,
  timestamp: string,
): void => {
  wave.startedAt =
    !wave.startedAt || timestamp < wave.startedAt ? timestamp : wave.startedAt;
};

const detectWaveStatusFromTodoWrite = (
  chunk: AgentLogChunk,
): Array<{ waveNumber: number; status: TimelinePhase["status"] }> => {
  const parsed = parseJsonRecord(chunk.message);
  if (parsed?.name !== "TodoWrite") return [];

  const input =
    typeof parsed.input === "object" && parsed.input !== null
      ? (parsed.input as Record<string, unknown>)
      : null;
  const todos = Array.isArray(input?.todos) ? input.todos : [];
  const result: Array<{ waveNumber: number; status: TimelinePhase["status"] }> = [];

  for (const todo of todos) {
    if (typeof todo !== "object" || todo === null) continue;
    const todoRecord = todo as Record<string, unknown>;
    const content = [
      typeof todoRecord.content === "string" ? todoRecord.content : "",
      typeof todoRecord.activeForm === "string" ? todoRecord.activeForm : "",
    ].join(" ");
    const waveMatch = content.match(/\bWave\s+(\d+)\b/i);
    if (!waveMatch?.[1]) continue;

    const todoStatus = todoRecord.status;
    const status: TimelinePhase["status"] =
      todoStatus === "completed"
        ? "done"
        : todoStatus === "in_progress"
          ? "active"
          : "pending";
    result.push({ waveNumber: Number(waveMatch[1]), status });
  }

  return result;
};

const buildWaveTimelinePhases = (
  chunks: AgentLogChunk[],
  isLive: boolean,
): TimelinePhase[] => {
  const waves = new Map<number, WaveTimelineInfo>();

  const ensureWave = (waveNumber: number): WaveTimelineInfo => {
    const existing = waves.get(waveNumber);
    if (existing) return existing;

    const created: WaveTimelineInfo = {
      waveNumber,
      status: "pending",
      startedAt: null,
      eventCount: 0,
    };
    waves.set(waveNumber, created);
    return created;
  };

  for (const chunk of chunks) {
    const message = chunk.message ?? "";

    for (const match of message.matchAll(/\bWave\s+(\d+)(?:\s*(?:\([^)]*\))?\s*:\s*(\d+)\s+tasks?)?/gi)) {
      const waveNumber = Number(match[1]);
      if (!Number.isFinite(waveNumber)) continue;

      const wave = ensureWave(waveNumber);
      if (match[2]) {
        wave.taskCount = Number(match[2]);
      }
      wave.eventCount += 1;
    }

    for (const statusUpdate of detectWaveStatusFromTodoWrite(chunk)) {
      const wave = ensureWave(statusUpdate.waveNumber);
      wave.status = updateWaveStatus(wave.status, statusUpdate.status);
      wave.eventCount += 1;
      if (statusUpdate.status !== "pending") {
        setWaveStartedAt(wave, chunk.timestamp);
      }
    }

    const activeWaveNumber = [
      message.match(
        /\b(?:Moving|launching|executing|starting|started)\s+Wave\s+(\d+)\b/i,
      )?.[1],
      message.match(
        /\bWave\s+(\d+)\s+(?:started|launched|running|in progress)\b/i,
      )?.[1],
    ].find(Boolean);

    if (activeWaveNumber) {
      const wave = ensureWave(Number(activeWaveNumber));
      wave.status = updateWaveStatus(wave.status, "active");
      wave.eventCount += 1;
      setWaveStartedAt(wave, chunk.timestamp);
    }
  }

  const orderedWaves = [...waves.values()].sort(
    (left, right) => left.waveNumber - right.waveNumber,
  );
  if (orderedWaves.length === 0) return [];

  if (isLive && !orderedWaves.some((wave) => wave.status === "active")) {
    const firstPending = orderedWaves.find((wave) => wave.status === "pending");
    if (firstPending) {
      firstPending.status = "active";
    }
  }

  const highestActiveWaveNumber = Math.max(
    ...orderedWaves
      .filter((wave) => wave.status === "active")
      .map((wave) => wave.waveNumber),
  );

  if (Number.isFinite(highestActiveWaveNumber)) {
    for (const wave of orderedWaves) {
      if (wave.waveNumber < highestActiveWaveNumber && wave.status !== "done") {
        wave.status = "done";
      }
    }
  }

  return orderedWaves.map<TimelinePhase>((wave) => ({
    id: `wave-${wave.waveNumber}`,
    label: `Wave ${wave.waveNumber}`,
    status: wave.status,
    startedAt: wave.startedAt,
    eventCount: wave.eventCount,
    details:
      typeof wave.taskCount === "number"
        ? [`${wave.taskCount} ${wave.taskCount === 1 ? "task" : "tasks"}`]
        : undefined,
  }));
};

export const buildSessionTimelinePhases = (
  chunks: AgentLogChunk[],
  jobType: AgentJobType | string | undefined,
  isLive: boolean,
): TimelinePhase[] => {
  const chunksByPhase = new Map<string, AgentLogChunk[]>();
  for (const chunk of chunks) {
    const existing = chunksByPhase.get(chunk.phase) ?? [];
    existing.push(chunk);
    chunksByPhase.set(chunk.phase, existing);
  }

  const groups = getTimelineGroups(jobType);
  const representedPhases = new Set<string>();
  const wavePhases =
    jobType === "implementation" ? buildWaveTimelinePhases(chunks, isLive) : [];

  const groupedPhases = groups
    .map<TimelinePhase | null>((group) => {
      const matchingChunks = group.sourcePhases.flatMap((phase) => {
        const phaseChunks = chunksByPhase.get(phase) ?? [];
        if (phaseChunks.length > 0) {
          representedPhases.add(phase);
        }
        return phaseChunks;
      });

      if (matchingChunks.length === 0) {
        return null;
      }

      return {
        id: group.id,
        label: group.label,
        status: "done",
        startedAt: getEarliestTimestamp(matchingChunks),
        eventCount: matchingChunks.length,
        details: group.sourcePhases
          .filter((phase) => (chunksByPhase.get(phase)?.length ?? 0) > 0)
          .map(formatPhaseLabel),
      };
    })
    .filter((phase): phase is TimelinePhase => phase !== null);

  const fallbackPhases = Array.from(chunksByPhase.entries())
    .filter(([phase]) => !representedPhases.has(phase))
    .map<TimelinePhase>(([phase, phaseChunks]) => ({
      id: phase,
      label: formatPhaseLabel(phase),
      status: "done",
      startedAt: getEarliestTimestamp(phaseChunks),
      eventCount: phaseChunks.length,
    }))
    .sort((left, right) => {
      const leftStartedAt = left.startedAt ?? "";
      const rightStartedAt = right.startedAt ?? "";
      return leftStartedAt.localeCompare(rightStartedAt);
    });

  const hasWavePhases = wavePhases.length > 0;
  const hasPostExecutionGitChunks =
    (chunksByPhase.get("git")?.length ?? 0) > 0 ||
    (chunksByPhase.get("commit")?.length ?? 0) > 0 ||
    (chunksByPhase.get("push")?.length ?? 0) > 0;
  const hasIncompleteWavePhases = wavePhases.some(
    (phase) => phase.status !== "done",
  );
  const phases = hasWavePhases
    ? [
        ...groupedPhases.filter((phase) =>
          ["claim", "prepare"].includes(phase.id),
        ),
        ...wavePhases,
        ...groupedPhases.filter((phase) =>
          phase.id === "finish" ||
          (phase.id === "git" && hasPostExecutionGitChunks && !hasIncompleteWavePhases),
        ),
        ...fallbackPhases.filter((phase) => phase.id !== "transcript"),
      ]
    : [...groupedPhases, ...fallbackPhases];

  if (phases.length === 0) {
    return [];
  }

  if (hasWavePhases) {
    if (isLive && !phases.some((phase) => phase.status === "active")) {
      const lastPhaseIndex = phases.length - 1;
      return phases.map((phase, index) => ({
        ...phase,
        status: index === lastPhaseIndex ? "active" : phase.status,
      }));
    }

    return phases;
  }

  const lastPhaseIndex = phases.length - 1;
  return phases.map((phase, index) => ({
    ...phase,
    status: isLive && index === lastPhaseIndex ? "active" : "done",
  }));
};

export const useSessionEventTimeline = (
  chunks: AgentLogChunk[],
  jobType: AgentJobType | string | undefined,
  isLive: boolean,
): { phases: TimelinePhase[] } => {
  const phases = useMemo(
    () => buildSessionTimelinePhases(chunks, jobType, isLive),
    [chunks, jobType, isLive],
  );

  return { phases };
};
