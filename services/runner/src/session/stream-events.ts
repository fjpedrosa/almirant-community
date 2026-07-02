// ---------------------------------------------------------------------------
// Stream event publishing utilities
//
// Extracted from job-executor.ts — sequence tracking, stream channel adapter,
// and fire-and-forget event publishers.
// ---------------------------------------------------------------------------

import type {
  StreamPublisher,
  AgentOutputEvent,
  CanonicalEventEnvelope,
  NativeEventEnvelope,
} from "@almirant/stream-consumer";
import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import { sanitizeLogContent } from "../observability/log-sanitizer";

/** Interval in ms for throttled queue publishing of streaming output. */
export const QUEUE_PUBLISH_THROTTLE_MS = 2_000;

// ---------------------------------------------------------------------------
// Sequence number tracking for stream events
// ---------------------------------------------------------------------------

let _globalSequence = 0;
export const nextSequence = (): number => ++_globalSequence;

// ---------------------------------------------------------------------------
// Stream-backed channel adapter
// ---------------------------------------------------------------------------

/**
 * Thin adapter that publishes stream events instead of calling Discord directly.
 * Satisfies the subset of DiscordRichChannelAdapter required by BidirectionalRelay.
 */
export const createStreamChannelAdapter = (params: {
  streamPublisher: StreamPublisher;
  jobId: string;
  threadId: string;
  sessionId: string;
  organizationId: string;
}): Pick<DiscordRichChannelAdapter, "sendMessage" | "sendRichMessage"> => ({
  sendMessage: async (targetThreadId, content) => {
    await params.streamPublisher
      .publish({
        type: "message",
        jobId: params.jobId,
        threadId: targetThreadId || params.threadId,
        sessionId: params.sessionId,
        organizationId: params.organizationId,
        content: sanitizeLogContent(typeof content === "string" ? content : String(content)),
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
      })
      .catch(() => undefined);
    return { id: `q-${Date.now()}`, content: String(content), channelId: "" };
  },
  sendRichMessage: async (targetThreadId, payload) => {
    await params.streamPublisher
      .publish({
        type: "rich_message",
        jobId: params.jobId,
        threadId: targetThreadId || params.threadId,
        sessionId: params.sessionId,
        organizationId: params.organizationId,
        payload: payload as Record<string, unknown>,
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
      })
      .catch(() => undefined);
    return { id: `q-${Date.now()}`, content: "", channelId: "" };
  },
});

// ---------------------------------------------------------------------------
// Helper: publish a typed event to the stream (fire-and-forget)
// ---------------------------------------------------------------------------

export const publishStreamEvent = async (
  publisher: StreamPublisher | undefined,
  event: Omit<AgentOutputEvent, "sequenceNumber">
): Promise<void> => {
  if (!publisher) return;
  await publisher.publish({ ...event, sequenceNumber: nextSequence() }).catch(() => undefined);
};

/**
 * Publish a canonical event envelope to Redis Stream via raw XADD.
 * Uses the same StreamPublisher's Redis connection but writes in canonical format.
 */
export const publishCanonicalEvent = async (
  publisher: StreamPublisher | undefined,
  envelope: CanonicalEventEnvelope,
): Promise<void> => {
  if (!publisher) return;
  await publisher.publishCanonicalEnvelope(envelope).catch((err) => {
    console.error(`[canonical-publish] Failed to publish canonical event: ${err instanceof Error ? err.message : String(err)}`);
  });
};

/**
 * Publish a canonical `job.started` event at the beginning of an attempt.
 *
 * Runners are ephemeral: the quota-pause and pre-session-timeout retry paths
 * reuse the SAME jobId on a fresh runner whose per-process sequence counter
 * restarts low, WITHOUT emitting a terminal event. The web-bridge consumer uses
 * job.started to reset its per-job dedup high-water mark, so the resumed
 * attempt's events are not mistaken for stale/duplicate redeliveries and
 * dropped. Emitting this at the start of EVERY attempt (initial and resumed) is
 * what makes the resume safe.
 */
export const publishJobStarted = async (
  publisher: StreamPublisher | undefined,
  params: {
    jobId: string;
    sessionId: string;
    organizationId: string;
    threadId: string;
    model?: string;
    branch?: string;
  },
): Promise<void> => {
  await publishCanonicalEvent(publisher, {
    jobId: params.jobId,
    sessionId: params.sessionId,
    organizationId: params.organizationId,
    threadId: params.threadId,
    timestamp: Date.now(),
    sequenceNumber: nextSequence(),
    event: {
      kind: "job.started",
      ...(params.model ? { model: params.model } : {}),
      ...(params.branch ? { branch: params.branch } : {}),
    },
  });
};

/**
 * Publish a native runtime event envelope to Redis Stream. Native events are
 * diagnostic/source-of-truth records and are persisted separately from canonical
 * events so mapper bugs can be investigated after the job finishes.
 */
export const publishNativeEvent = async (
  publisher: StreamPublisher | undefined,
  envelope: NativeEventEnvelope,
): Promise<void> => {
  if (!publisher) return;
  await publisher.publishNativeEnvelope(envelope).catch((err) => {
    console.error(`[native-publish] Failed to publish native event: ${err instanceof Error ? err.message : String(err)}`);
  });
};
