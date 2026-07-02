import { describe, it, expect } from "bun:test";
import type {
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  AgentOutputEvent,
  StreamPublisher,
} from "@almirant/stream-consumer";
import { publishJobStarted, nextSequence } from "../src/session/stream-events";

// ---------------------------------------------------------------------------
// A minimal in-memory StreamPublisher that records canonical envelopes.
// ---------------------------------------------------------------------------

const createRecordingPublisher = (): {
  publisher: StreamPublisher;
  canonical: CanonicalEventEnvelope[];
} => {
  const canonical: CanonicalEventEnvelope[] = [];
  const publisher: StreamPublisher = {
    publish: async (_event: AgentOutputEvent) => "0-0",
    publishCanonicalEnvelope: async (envelope: CanonicalEventEnvelope) => {
      canonical.push(envelope);
      return "0-0";
    },
    publishNativeEnvelope: async (_envelope: NativeEventEnvelope) => "0-0",
    close: async () => {},
  };
  return { publisher, canonical };
};

describe("publishJobStarted", () => {
  it("emits a canonical job.started envelope at the start of an attempt", async () => {
    const { publisher, canonical } = createRecordingPublisher();

    await publishJobStarted(publisher, {
      jobId: "job-42",
      sessionId: "session-42",
      organizationId: "org-42",
      threadId: "thread-42",
    });

    expect(canonical.length).toBe(1);
    const env = canonical[0]!;
    expect(env.event.kind).toBe("job.started");
    expect(env.jobId).toBe("job-42");
    expect(env.sessionId).toBe("session-42");
    expect(env.organizationId).toBe("org-42");
    expect(env.threadId).toBe("thread-42");
    expect(typeof env.sequenceNumber).toBe("number");
  });

  it("forwards optional model/branch metadata onto the job.started event", async () => {
    const { publisher, canonical } = createRecordingPublisher();

    await publishJobStarted(publisher, {
      jobId: "job-1",
      sessionId: "session-1",
      organizationId: "org-1",
      threadId: "thread-1",
      model: "claude-opus",
      branch: "feature/foo",
    });

    const env = canonical[0]!;
    if (env.event.kind !== "job.started") throw new Error("expected job.started");
    expect(env.event.model).toBe("claude-opus");
    expect(env.event.branch).toBe("feature/foo");
  });

  it("is a no-op when no publisher is configured (redis disabled)", async () => {
    // Must not throw when streamPublisher is undefined.
    await publishJobStarted(undefined, {
      jobId: "job-1",
      sessionId: "session-1",
      organizationId: "org-1",
      threadId: "thread-1",
    });
    expect(typeof nextSequence()).toBe("number");
  });
});
