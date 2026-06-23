import { createHash } from "crypto";
import {
  createMemoryTelemetry,
  createObservation,
  supersedeObservation,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { assertSafeMemoryPayload, assertSafeMemoryText } from "./scrubber";
import { normalizeTopicKey, parseConfidence } from "./ranker";

type TerminalJobStatus = "completed" | "incomplete" | "failed" | "cancelled";

type MemoryCandidate = {
  type: string;
  topicKey: string;
  title: string;
  content: string;
  scope?: string;
  confidence?: number;
  visibility?: "personal" | "project" | "org";
  metadata?: Record<string, unknown>;
  supersedesObservationId?: string;
};

type PersistJobMemoryArgs = {
  organizationId: string;
  projectId?: string | null;
  agentJobId: string;
  workItemId?: string | null;
  feedbackItemId?: string | null;
  status: TerminalJobStatus;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const extractStructuredCandidates = (
  result: Record<string, unknown> | null
): MemoryCandidate[] => {
  const raw = result?.memoryObservations;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .flatMap((item) => {
      if (
        typeof item.type !== "string" ||
        typeof item.topicKey !== "string" ||
        typeof item.title !== "string" ||
        typeof item.content !== "string"
      ) {
        return [];
      }
      return [
        {
          type: item.type,
          topicKey: item.topicKey,
          title: item.title,
          content: item.content,
          scope: typeof item.scope === "string" ? item.scope : undefined,
          confidence:
            typeof item.confidence === "number" ? item.confidence : undefined,
          visibility:
            item.visibility === "personal" ||
            item.visibility === "project" ||
            item.visibility === "org"
              ? item.visibility
              : "project",
          metadata: asRecord(item.metadata) ?? undefined,
          supersedesObservationId:
            typeof item.supersedesObservationId === "string"
              ? item.supersedesObservationId
              : undefined,
        },
      ];
    });
};

const buildFailureCandidate = (
  args: PersistJobMemoryArgs
): MemoryCandidate | null => {
  if (args.status !== "failed") return null;

  const rootCause =
    typeof args.result?.rootCause === "string" ? args.result.rootCause : null;
  const summary =
    typeof args.result?.summary === "string" ? args.result.summary : null;
  const fix =
    typeof args.result?.fix === "string"
      ? args.result.fix
      : typeof args.result?.solutionProposed === "string"
        ? args.result.solutionProposed
        : null;
  const errorMessage = args.errorMessage?.trim() || null;

  if (!rootCause && !summary && !errorMessage) return null;

  const content = [
    rootCause ? `Root cause: ${rootCause}` : null,
    summary ? `Summary: ${summary}` : null,
    fix ? `Proposed fix: ${fix}` : null,
    errorMessage ? `Error: ${errorMessage}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    type: "bugfix",
    topicKey: `bugfix/agent-job-${args.agentJobId}`,
    title: "Bugfix: terminal job diagnosis",
    content,
    confidence: 0.5,
    visibility: "project",
    metadata: {
      source: "post-job",
      terminalStatus: args.status,
    },
  };
};

export const persistJobMemoryFromTerminalState = async (
  args: PersistJobMemoryArgs
) => {
  const candidates = [
    ...extractStructuredCandidates(args.result ?? null),
    ...(buildFailureCandidate(args) ? [buildFailureCandidate(args)!] : []),
  ];

  if (candidates.length === 0) {
    return { saved: 0 };
  }

  const savedIds: string[] = [];

  for (const candidate of candidates) {
    try {
      const title = assertSafeMemoryText(candidate.title, "title");
      const content = assertSafeMemoryText(candidate.content, "content");
      const metadata = assertSafeMemoryPayload(candidate.metadata);
      const topicKey = normalizeTopicKey(candidate.type, candidate.topicKey);

      const observation = await createObservation({
        organizationId: args.organizationId,
        projectId: args.projectId ?? null,
        agentJobId: args.agentJobId,
        workItemId: args.workItemId ?? null,
        feedbackItemId: args.feedbackItemId ?? null,
        type: candidate.type as any,
        topicKey,
        title,
        content,
        scope: candidate.scope,
        visibility: candidate.visibility ?? "project",
        confidence: parseConfidence(candidate.confidence ?? 0.5).toFixed(2),
        contentHash: createHash("sha256").update(title + content).digest("hex"),
        metadata: metadata
          ? {
              ...metadata,
              source: "post-job",
            }
          : { source: "post-job" },
      });

      savedIds.push(observation.id);

      if (candidate.supersedesObservationId) {
        await supersedeObservation(
          candidate.supersedesObservationId,
          observation.id
        );
      }
    } catch (error) {
      logger.warn(
        { error, agentJobId: args.agentJobId, candidateType: candidate.type },
        "memory: failed to persist post-job observation"
      );
    }
  }

  if (savedIds.length > 0) {
    await createMemoryTelemetry({
      organizationId: args.organizationId,
      agentJobId: args.agentJobId,
      event: "save",
      resultCount: savedIds.length,
      hits: savedIds.map((id, index) => ({
        observationId: id,
        rank: index + 1,
        score: 1,
        injected: false,
      })),
    });
  }

  return { saved: savedIds.length, savedIds };
};
