import type { ExecutionBoundary } from "@almirant/shared";
import type { ContainerDriver } from "./container-driver";

type ContainerState = {
  running: boolean;
  oomKilled: boolean;
  exitCode: number | null;
};

type DeadlineBoundContainerOperation<T> = (input: {
  signal: AbortSignal;
}) => Promise<T>;

const raceWithAbort = async <T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  // A third-party driver may accidentally ignore AbortSignal. Keep a local
  // backstop so the runner slot still settles, while a signal-aware driver
  // receives the same signal and cancels its HTTP request for real.
  operation.catch(() => undefined);

  if (signal.aborted) {
    throw signal.reason ?? new Error("container operation aborted");
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("container operation aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

const SIGNAL_OPTION_INDEX = new Map<PropertyKey, number>([
  ["pullImage", 1],
  ["createContainer", 2],
  ["startContainer", 1],
  ["getContainerIp", 2],
  ["connectToNetwork", 2],
  ["resolveAgentEgressProxy", 2],
  ["assertAgentControlNetwork", 1],
  ["assertContainerNetworkIsolation", 3],
  ["inspectContainer", 1],
  ["isContainerRunning", 1],
  ["stopContainer", 2],
  ["removeContainer", 2],
  ["execInContainer", 3],
  ["writeFileViaExec", 3],
  ["writeFileBufferViaExec", 4],
  ["restoreArchiveViaExec", 3],
  ["getArchiveFromContainer", 2],
  ["extractWorkspaceArchive", 3],
  ["putArchiveToContainer", 3],
]);

/**
 * Bind a watchdog signal to every signal-aware operation reached by a
 * higher-level workspace/plugin/provisioning composite.
 *
 * Community's ContainerDriver methods do not declare a signal option yet
 * (that would be a separate, much wider interface change). This proxy still
 * injects the signal as an extra positional argument at the recorded index —
 * concrete drivers that don't read it simply ignore the extra argument, and
 * `runDeadlineBoundContainerOperation`'s local race still bounds the caller.
 */
export const bindContainerDriverSignal = (
  driver: ContainerDriver,
  signal: AbortSignal,
): ContainerDriver => new Proxy(driver, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== "function") return value;
    const optionsIndex = SIGNAL_OPTION_INDEX.get(property);
    if (optionsIndex === undefined) return value.bind(target);

    return (...args: unknown[]) => {
      const nextArgs = [...args];
      const existing = nextArgs[optionsIndex] as
        | { signal?: AbortSignal }
        | undefined;
      nextArgs[optionsIndex] = {
        ...existing,
        signal: existing?.signal && existing.signal !== signal
          ? AbortSignal.any([signal, existing.signal])
          : signal,
      };
      return (value as (...methodArgs: unknown[]) => unknown)
        .apply(target, nextArgs);
    };
  },
});

/**
 * Execute material container I/O behind the live execution boundary.
 *
 * The signal is both propagated to the concrete driver and raced locally.
 * The post-await assertion closes the success-at-cutoff TOCTOU window.
 */
export const runDeadlineBoundContainerOperation = async <T>(
  boundary: ExecutionBoundary,
  maxTimeoutMs: number,
  operation: DeadlineBoundContainerOperation<T>,
): Promise<T> => {
  boundary.assertOpen();
  const signal = boundary.signal(maxTimeoutMs);
  const pending = Promise.resolve().then(() => operation({ signal }));

  try {
    const result = await raceWithAbort(pending, signal);
    boundary.assertOpen();
    return result;
  } catch (error) {
    if (signal.aborted) {
      // At the canonical work cutoff this throws the stable domain error. If a
      // shorter operation cap fired first, preserve that timeout reason.
      boundary.assertOpen();
      throw signal.reason ?? error;
    }
    boundary.assertOpen();
    throw error;
  }
};

type IndependentTeardownInput = {
  inspectTimeoutMs: number;
  beforeStopTimeoutMs?: number;
  stopTimeoutMs: number;
  removeTimeoutMs: number;
  inspect: (signal: AbortSignal) => Promise<ContainerState>;
  beforeStop?: (
    containerState: ContainerState | null,
    signal: AbortSignal,
  ) => Promise<void>;
  stop: (signal: AbortSignal) => Promise<void>;
  remove: (signal: AbortSignal) => Promise<void>;
};

export type IndependentTeardownResult = {
  containerState: ContainerState | null;
  errors: Error[];
};

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const runWithIndependentBudget = async <T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, Math.max(1, Math.ceil(timeoutMs)));

  try {
    return await raceWithAbort(
      Promise.resolve().then(() => operation(controller.signal)),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Cleanup must make forward progress even when Docker inspect/stop hangs.
 * Every step owns an independent budget and remove is always attempted.
 */
export const teardownContainerWithIndependentBudgets = async (
  input: IndependentTeardownInput,
): Promise<IndependentTeardownResult> => {
  const errors: Error[] = [];
  let containerState: ContainerState | null = null;

  try {
    containerState = await runWithIndependentBudget(
      "container cleanup inspect",
      input.inspectTimeoutMs,
      input.inspect,
    );
  } catch (error) {
    errors.push(normalizeError(error));
  }

  if (input.beforeStop) {
    try {
      await runWithIndependentBudget(
        "container cleanup diagnostics",
        input.beforeStopTimeoutMs ?? input.inspectTimeoutMs,
        (signal) => input.beforeStop!(containerState, signal),
      );
    } catch (error) {
      errors.push(normalizeError(error));
    }
  }

  try {
    await runWithIndependentBudget(
      "container cleanup stop",
      input.stopTimeoutMs,
      input.stop,
    );
  } catch (error) {
    errors.push(normalizeError(error));
  }

  try {
    await runWithIndependentBudget(
      "container cleanup remove",
      input.removeTimeoutMs,
      input.remove,
    );
  } catch (error) {
    errors.push(normalizeError(error));
  }

  return { containerState, errors };
};
