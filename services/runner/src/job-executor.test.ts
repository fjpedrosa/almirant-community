import { describe, expect, it } from "bun:test";
import {
  resolveTeardownFailureEvent,
  shouldPrepareParentRuntime,
} from "./job-executor";
import { classifyContainerFailure } from "./shared/failure-signal";

describe("native Plan Review parent runtime preparation", () => {
  it("bypasses the parent runtime only for ready native reviews", () => {
    expect(shouldPrepareParentRuntime({ jobType: "review", planReviewStatus: "ready" })).toBe(false);
    expect(shouldPrepareParentRuntime({ jobType: "review", planReviewStatus: "skipped_unavailable" })).toBe(true);
    expect(shouldPrepareParentRuntime({ jobType: "implementation", planReviewStatus: "ready" })).toBe(true);
    expect(shouldPrepareParentRuntime({ jobType: "review" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTeardownFailureEvent — the teardown-time event-emission decision
//
// Community's pre-session recovery (stale-job-recovery.ts's
// isPreSessionStartupStuck) is purely time-based — elapsed time since
// serve.ready plus the absence of a session.created log — and never inspects
// job-log event types. Unlike cloud, it has no causal dependency on
// "container.unexpected_exit" specifically, so a heuristic OOM verdict here
// emits a single event using the same non-authoritative wording as the
// session-phase classifier, instead of cloud's dual oom_killed +
// unexpected_exit emission (which exists only to satisfy that dependency).
// ---------------------------------------------------------------------------

describe("resolveTeardownFailureEvent", () => {
  it("emits container.oom_killed for an authoritative Docker OOM verdict", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: true, exitCode: 137 },
      inspected: true,
      message: "",
      lifecyclePhase: "teardown",
    });

    const event = resolveTeardownFailureEvent(signal, true, false, "container-1");

    expect(event?.eventType).toBe("container.oom_killed");
    expect(event?.message).toBe("Container was OOM-killed by Docker");
  });

  it("emits container.oom_suspected (not the authoritative wording) for a heuristic exit-137 verdict", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 137 },
      inspected: true,
      message: "",
      lifecyclePhase: "teardown",
    });

    const event = resolveTeardownFailureEvent(signal, true, false, "container-1");

    expect(event?.eventType).toBe("container.oom_suspected");
    expect(event?.message).toBe("Container exited 137 (SIGKILL); Docker reported no OOM flag");
  });

  it("emits container.unexpected_exit for a non-OOM bad exit", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 1 },
      inspected: true,
      message: "",
      lifecyclePhase: "teardown",
    });

    const event = resolveTeardownFailureEvent(signal, true, false, "container-1");

    expect(event?.eventType).toBe("container.unexpected_exit");
  });

  it("emits nothing for a clean exit", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: false, exitCode: 0 },
      inspected: true,
      message: "",
      lifecyclePhase: "teardown",
    });

    const event = resolveTeardownFailureEvent(signal, false, false, "container-1");

    expect(event).toBeNull();
  });

  // F5 regression: once evaluateCompletion already recorded an authoritative
  // OOM upstream, oomAlreadyDetected suppresses the teardown oom_killed
  // re-emission (avoiding double-reporting one OOM for one job), falling
  // through to the diedBadly branch instead.
  it("emits container.unexpected_exit (not a second oom_killed) when the OOM was already detected upstream", () => {
    const signal = classifyContainerFailure({
      containerState: { running: false, oomKilled: true, exitCode: 137 },
      inspected: true,
      message: "",
      lifecyclePhase: "teardown",
    });

    const event = resolveTeardownFailureEvent(signal, true, true, "container-1");

    expect(event?.eventType).toBe("container.unexpected_exit");
  });
});
