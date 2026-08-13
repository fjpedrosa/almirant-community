import type { ErrorClassification } from "./types";

export type OomEvidence =
  | "docker_oom_killed"
  | "docker_exit_137"
  | "text_heuristic"
  | "none";

export type FailureLifecyclePhase =
  | "pre_session"
  | "session"
  | "teardown"
  | "reconciliation";

export type ContainerInspectState = {
  running: boolean;
  oomKilled: boolean;
  exitCode: number | null;
};

export type ContainerFailureSignal = {
  classification: ErrorClassification;
  oom: boolean;
  evidence: OomEvidence;
  confidence: "authoritative" | "heuristic";
  lifecyclePhase: FailureLifecyclePhase;
  exitCode: number | null;
  inspected: boolean;
  message: string;
};

export type ClassifyContainerFailureInput = {
  containerState?: ContainerInspectState | null;
  inspected: boolean;
  message: string;
  lifecyclePhase: FailureLifecyclePhase;
};

// Narrow on purpose: only consulted when Docker could not be inspected, so it
// must never fire on incidental mentions of "memory" or "killed" the way the
// old broad OOM_PATTERNS did (e.g. "failed to write memory profile to disk",
// "process killed by user").
export const OOM_TEXT_FALLBACK_PATTERN =
  /\boom[-_ ]?killed\b|\bout\s*of\s*memory|\bcannot allocate memory\b|\ballocation failed\b|\bmemoryerror\b|\bmemory allocation of \d+ bytes failed\b|\bmemory limit (?:exceeded|reached)\b/i;

const TIMEOUT_PATTERN = /timeout|timed out|timed_out/i;
const DISCONNECT_PATTERN = /econnreset|socket hang up|sse|disconnect|econnrefused|epipe|fetch failed|unable to connect/i;
const AUTH_PATTERN = /\b401\b|\b403\b|unauthorized|forbidden/i;
const CONFIG_PATTERN = /invalid config|missing.*config|not found.*repo|repo.*not found|missing.*skill|skill.*not found/i;

const classifyNonOomMessage = (message: string): ErrorClassification => {
  if (TIMEOUT_PATTERN.test(message)) return "recoverable_timeout";
  if (DISCONNECT_PATTERN.test(message)) return "recoverable_disconnect";
  if (AUTH_PATTERN.test(message)) return "permanent_auth";
  if (CONFIG_PATTERN.test(message)) return "permanent_config";
  return "permanent_unknown";
};

/**
 * Single authoritative classifier for container-level job failures.
 *
 * Precedence is strict: Docker's own `OOMKilled` flag wins over everything,
 * a bare SIGKILL exit code is a heuristic second opinion, and the error-text
 * pattern is a last resort used ONLY when Docker could not be inspected at
 * all. When Docker was inspected and reports no OOM kill, the text heuristic
 * is never consulted — that is what stops "failed to write memory profile
 * to disk" or "process killed by user" from being misread as an OOM.
 */
export const classifyContainerFailure = (
  input: ClassifyContainerFailureInput,
): ContainerFailureSignal => {
  const { containerState, inspected, message, lifecyclePhase } = input;
  const exitCode = containerState?.exitCode ?? null;

  if (containerState?.oomKilled === true) {
    return {
      classification: "recoverable_oom",
      oom: true,
      evidence: "docker_oom_killed",
      confidence: "authoritative",
      lifecyclePhase,
      exitCode,
      inspected,
      message,
    };
  }

  if (inspected && exitCode === 137) {
    return {
      classification: "recoverable_oom",
      oom: true,
      evidence: "docker_exit_137",
      confidence: "heuristic",
      lifecyclePhase,
      exitCode,
      inspected,
      message,
    };
  }

  if (!inspected && OOM_TEXT_FALLBACK_PATTERN.test(message)) {
    return {
      classification: "recoverable_oom",
      oom: true,
      evidence: "text_heuristic",
      confidence: "heuristic",
      lifecyclePhase,
      exitCode,
      inspected,
      message,
    };
  }

  return {
    classification: classifyNonOomMessage(message),
    oom: false,
    evidence: "none",
    confidence: "heuristic",
    lifecyclePhase,
    exitCode,
    inspected,
    message,
  };
};

/**
 * Recognizes the exact synthetic state a container driver returns after
 * swallowing an inspect error (daemon unreachable, "No such container",
 * permission denied) instead of rejecting the promise. Docker always reports
 * a numeric ExitCode once a container has been genuinely inspected — even a
 * never-started container reads 0 — so `running: false` with `exitCode: null`
 * only occurs when the driver gave up, never from a real inspect result.
 */
export const isUnverifiedInspectResult = (state: ContainerInspectState): boolean =>
  state.running === false && state.exitCode === null;

export type OomFailureEventDescription = {
  eventType: "container.oom_killed" | "container.oom_suspected";
  message: string;
};

/**
 * Only meaningful when `signal.oom` is true; callers must check that first.
 */
export const describeOomFailureEvent = (
  signal: ContainerFailureSignal,
): OomFailureEventDescription => {
  if (signal.confidence === "authoritative") {
    return {
      eventType: "container.oom_killed",
      message: "Container was OOM-killed by Docker",
    };
  }
  if (signal.evidence === "docker_exit_137") {
    return {
      eventType: "container.oom_suspected",
      message: "Container exited 137 (SIGKILL); Docker reported no OOM flag",
    };
  }
  return {
    eventType: "container.oom_suspected",
    message: "Container exited without a confirmed Docker OOM flag; failure text matched a known OOM signature",
  };
};
