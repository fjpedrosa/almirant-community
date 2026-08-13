import { describe, expect, it } from "bun:test";
import {
  classifyContainerFailure,
  describeOomFailureEvent,
  isUnverifiedInspectResult,
  OOM_TEXT_FALLBACK_PATTERN,
  type FailureLifecyclePhase,
} from "./failure-signal";

describe("classifyContainerFailure", () => {
  it("classifies an authoritative Docker OOM kill regardless of the error text", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: true, exitCode: 137 },
      inspected: true,
      message: "agent exited",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(true);
    expect(signal.evidence).toBe("docker_oom_killed");
    expect(signal.confidence).toBe("authoritative");
    expect(signal.classification).toBe("recoverable_oom");
  });

  it("does not classify a memory-profiling failure as an OOM when Docker reports no OOM kill", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 1 },
      inspected: true,
      message: "failed to write memory profile to disk",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(false);
    expect(signal.evidence).toBe("none");
    expect(signal.classification).not.toBe("recoverable_oom");
  });

  it("does not classify a user-initiated kill as an OOM", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 0 },
      inspected: true,
      message: "job killed by user request",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(false);
    expect(signal.classification).not.toBe("recoverable_oom");
  });

  it("treats a SIGKILL exit as a heuristic OOM when Docker reports no explicit OOM flag", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 137 },
      inspected: true,
      message: "agent exited",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(true);
    expect(signal.evidence).toBe("docker_exit_137");
    expect(signal.confidence).toBe("heuristic");
    expect(signal.classification).toBe("recoverable_oom");
  });

  it("falls back to the text heuristic only when the container could not be inspected", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "Container was OOMKilled",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(true);
    expect(signal.evidence).toBe("text_heuristic");
    expect(signal.confidence).toBe("heuristic");
  });

  it("ignores the text heuristic when Docker was inspected and reported no OOM", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 1 },
      inspected: true,
      message: "out of memory",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(false);
    expect(signal.evidence).toBe("none");
  });

  it("matches javascript heap exhaustion in the narrow text fallback", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory",
      lifecyclePhase: "session",
    });

    expect(signal.oom).toBe(true);
    expect(signal.evidence).toBe("text_heuristic");
  });

  it("records the lifecycle phase verbatim", () => {
    const phases: FailureLifecyclePhase[] = [
      "pre_session",
      "session",
      "teardown",
      "reconciliation",
    ];

    for (const lifecyclePhase of phases) {
      const signal = classifyContainerFailure({
        containerState: null,
        inspected: false,
        message: "irrelevant",
        lifecyclePhase,
      });
      expect(signal.lifecyclePhase).toBe(lifecyclePhase);
    }
  });

  it("preserves the existing timeout classification for a non-OOM failure", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "request timed out",
      lifecyclePhase: "pre_session",
    });

    expect(signal.classification).toBe("recoverable_timeout");
    expect(signal.oom).toBe(false);
  });

  it("preserves the existing auth classification", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "401 unauthorized",
      lifecyclePhase: "pre_session",
    });

    expect(signal.classification).toBe("permanent_auth");
    expect(signal.oom).toBe(false);
  });

  it("reports inspected false when no container state is available", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "some unrelated failure",
      lifecyclePhase: "reconciliation",
    });

    expect(signal.inspected).toBe(false);
    expect(signal.exitCode).toBeNull();
  });
});

describe("OOM_TEXT_FALLBACK_PATTERN", () => {
  const genuineOomMessages = [
    "java.lang.OutOfMemoryError: Java heap space",
    "java.lang.OutOfMemoryError: GC overhead limit exceeded",
    "Traceback (most recent call last):\nMemoryError",
    "memory allocation of 4194304 bytes failed",
    "memory limit exceeded",
    "container memory limit reached",
  ];

  for (const message of genuineOomMessages) {
    it(`matches the unambiguous OOM string: ${message}`, () => {
      expect(OOM_TEXT_FALLBACK_PATTERN.test(message)).toBe(true);
    });
  }

  const falsePositiveMessages = [
    "failed to write memory profile to disk",
    "process killed by user",
  ];

  for (const message of falsePositiveMessages) {
    it(`does not match the deliberately-dropped false positive: ${message}`, () => {
      expect(OOM_TEXT_FALLBACK_PATTERN.test(message)).toBe(false);
    });
  }
});

describe("isUnverifiedInspectResult", () => {
  it("recognizes the synthetic state DockerContainerManager returns when it swallows an inspect error", () => {
    expect(
      isUnverifiedInspectResult({ running: false, oomKilled: false, exitCode: null }),
    ).toBe(true);
  });

  it("does not treat a genuinely inspected, non-running, zero-exit-code container as unverified", () => {
    expect(
      isUnverifiedInspectResult({ running: false, oomKilled: false, exitCode: 0 }),
    ).toBe(false);
  });

  it("does not treat a running container as unverified", () => {
    expect(
      isUnverifiedInspectResult({ running: true, oomKilled: false, exitCode: null }),
    ).toBe(false);
  });

  it("does not treat a genuinely inspected exit-137 container as unverified", () => {
    expect(
      isUnverifiedInspectResult({ running: false, oomKilled: false, exitCode: 137 }),
    ).toBe(false);
  });
});

describe("describeOomFailureEvent", () => {
  it("keeps the authoritative Docker-flag case byte-identical", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: true, exitCode: 137 },
      inspected: true,
      message: "agent exited",
      lifecyclePhase: "session",
    });

    expect(describeOomFailureEvent(signal)).toEqual({
      eventType: "container.oom_killed",
      message: "Container was OOM-killed by Docker",
    });
  });

  it("uses a distinct event code and message for the heuristic exit-137 case", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 137 },
      inspected: true,
      message: "agent exited",
      lifecyclePhase: "session",
    });

    expect(describeOomFailureEvent(signal)).toEqual({
      eventType: "container.oom_suspected",
      message: "Container exited 137 (SIGKILL); Docker reported no OOM flag",
    });
  });

  it("uses a distinct event code and message for the text-heuristic fallback case", () => {
    const signal = classifyContainerFailure({
      containerState: null,
      inspected: false,
      message: "FATAL ERROR: JavaScript heap out of memory",
      lifecyclePhase: "session",
    });

    expect(describeOomFailureEvent(signal)).toEqual({
      eventType: "container.oom_suspected",
      message: "Container exited without a confirmed Docker OOM flag; failure text matched a known OOM signature",
    });
  });
});
