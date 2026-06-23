/**
 * Resource monitoring for container tmpfs and disk-backed workspace.
 *
 * Extracted from JobExecutor — monitors tmpfs (/tmp, /home/opencode) and
 * disk-backed /workspace inside a running container, emitting warnings and
 * aborting the session at critical thresholds.
 */
import type { ContainerManager } from "../workspace/container-manager";
import type { RunnerJobEventLogger } from "./job-event-logger";
import { emitResourceUsage } from "./telemetry";
import { resolveJobIntent, resolveResourceTier, getResourcesForTier } from "../orchestration/job-intent";
import { computeMemoryLimit } from "../workspace/container-spec-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TMPFS_WATCH_INTERVAL_MS = 30_000;
export const TMPFS_WARNING_THRESHOLD = 85;
export const TMPFS_CRITICAL_THRESHOLD = 95;
/** Disk-backed /workspace limit in MB (10 GB). */
export const WORKSPACE_DISK_LIMIT_MB = 10_240;
export const WORKSPACE_DISK_WARNING_THRESHOLD = 0.85;
export const WORKSPACE_DISK_CRITICAL_THRESHOLD = 0.95;
export const RESOURCE_EXEC_TIMEOUT_MS = 10_000;
/**
 * Dedicated timeout for `du -sm /workspace`. Workspaces backed by virtiofs (or
 * any FS with high syscall latency) can take much longer than the regular
 * tmpfs/df checks. Sharing the smaller `RESOURCE_EXEC_TIMEOUT_MS` caused the
 * workspace disk monitor to disable itself after a single transient slowdown.
 */
export const WORKSPACE_DU_TIMEOUT_MS = 30_000;

type ExecInContainerResult = Awaited<ReturnType<ContainerManager["execInContainer"]>>;
type ResourceWatcherOptions = {
  checkIntervalMs?: number;
  execTimeoutMs?: number;
  workspaceDuTimeoutMs?: number;
};

const RESOURCE_TIMEOUT_CODE = "RESOURCE_MONITOR_EXEC_TIMEOUT";

const createTimeoutError = (label: string, timeoutMs: number): Error => {
  return Object.assign(
    new Error(`Resource monitor command timed out after ${timeoutMs}ms (${label})`),
    { code: RESOURCE_TIMEOUT_CODE },
  );
};

const isTimeoutError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === RESOURCE_TIMEOUT_CODE
  );
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const execInContainerWithTimeout = (
  containerManager: ContainerManager,
  containerId: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  label: string,
): Promise<ExecInContainerResult> => {
  return withTimeout(
    containerManager.execInContainer(containerId, args, cwd),
    timeoutMs,
    label,
  );
};

// ---------------------------------------------------------------------------
// startTmpfsWatcher
// ---------------------------------------------------------------------------

/**
 * Periodically monitors tmpfs and disk-backed workspace usage inside the container.
 * Returns a cleanup function and a shared flag object.
 *
 * - tmpfs (/tmp, /home/opencode): checked via `df -m` with percentage thresholds.
 * - disk-backed /workspace: checked via `du -sm` against WORKSPACE_DISK_LIMIT_MB.
 * - At warning threshold: logs warn, attempts lightweight cleanup.
 * - At critical threshold: logs error, sets critical flag to abort session.
 */
export function startTmpfsWatcher(
  containerManager: ContainerManager,
  containerId: string,
  jobId: string,
  eventLogger: RunnerJobEventLogger,
  options: ResourceWatcherOptions = {},
): { cleanup: () => void; isCritical: () => boolean } {
  let critical = false;
  let tmpfsWarningEmitted = false;
  let workspaceWarningEmitted = false;
  let checkInFlight = false;
  let overlapWarningEmitted = false;
  let tmpfsChecksDisabled = false;
  let workspaceDuDisabled = false;
  const checkIntervalMs = options.checkIntervalMs ?? TMPFS_WATCH_INTERVAL_MS;
  const execTimeoutMs = options.execTimeoutMs ?? RESOURCE_EXEC_TIMEOUT_MS;
  const workspaceDuTimeoutMs =
    options.workspaceDuTimeoutMs ?? WORKSPACE_DU_TIMEOUT_MS;

  const check = async () => {
    if (checkInFlight) {
      if (!overlapWarningEmitted) {
        overlapWarningEmitted = true;
        eventLogger.warn(
          "resources",
          "resources.check_skipped_in_flight",
          "Skipping resource check because the previous one is still running",
          { checkIntervalMs, execTimeoutMs },
        );
      }
      return;
    }

    checkInFlight = true;
    try {
      const usage: Record<string, { usedMb: number; totalMb: number; usePercent: number }> = {};
      let maxTmpfsPercent = 0;
      let workspaceUsedMb: number | undefined;
      let commandTimedOutThisCheck = false;

      // Check tmpfs mounts (/tmp, /home/opencode) via df
      if (!tmpfsChecksDisabled) {
        try {
          const { stdout: dfOut } = await execInContainerWithTimeout(
            containerManager,
            containerId,
            ["df", "-m", "/home/opencode"],
            "/",
            execTimeoutMs,
            "df /home/opencode",
          );
          const dfLines = dfOut.split("\n").filter((l) => l.startsWith("tmpfs"));

          for (const line of dfLines) {
            const parts = line.split(/\s+/);
            if (parts.length < 6) continue;
            const mountPoint = parts[5];
            const label = mountPoint.startsWith("/home") ? "home" : mountPoint;
            const pct = parseInt(parts[4], 10);
            usage[label] = { totalMb: parseInt(parts[1], 10), usedMb: parseInt(parts[2], 10), usePercent: pct };
            if (pct > maxTmpfsPercent) maxTmpfsPercent = pct;
          }
        } catch (error) {
          if (isTimeoutError(error)) {
            tmpfsChecksDisabled = true;
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[job:${jobId}] TMPFS monitor disabled after timeout: ${errorMessage}`);
            eventLogger.warn(
              "resources",
              "tmpfs.monitor_disabled_timeout",
              "Tmpfs monitor disabled after command timeout",
              { errorMessage, execTimeoutMs },
            );
            commandTimedOutThisCheck = true;
          } else {
            throw error;
          }
        }
      }

      // Check disk-backed /workspace via du. Uses its own (larger) timeout
      // because virtiofs-backed workspaces can take >10s for `du -sm` even
      // when no other resource issue is present.
      if (!workspaceDuDisabled && !commandTimedOutThisCheck) {
        try {
          const { stdout: duOut } = await execInContainerWithTimeout(
            containerManager,
            containerId,
            ["du", "-sm", "/workspace"],
            "/",
            workspaceDuTimeoutMs,
            "du -sm /workspace",
          );
          const duMatch = duOut.match(/^(\d+)/);
          workspaceUsedMb = duMatch ? parseInt(duMatch[1], 10) : 0;
          const workspacePercent = Math.round((workspaceUsedMb / WORKSPACE_DISK_LIMIT_MB) * 100);
          usage.workspace = { totalMb: WORKSPACE_DISK_LIMIT_MB, usedMb: workspaceUsedMb, usePercent: workspacePercent };
        } catch (error) {
          if (isTimeoutError(error)) {
            workspaceDuDisabled = true;
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[job:${jobId}] Workspace disk monitor disabled after timeout: ${errorMessage}`);
            eventLogger.warn(
              "resources",
              "workspace.disk_monitor_disabled_timeout",
              "Workspace disk monitor disabled after command timeout",
              { errorMessage, workspaceDuTimeoutMs },
            );
          } else {
            throw error;
          }
        }
      }

      // Evaluate tmpfs thresholds
      if (maxTmpfsPercent >= TMPFS_CRITICAL_THRESHOLD) {
        critical = true;
        console.error(`[job:${jobId}] TMPFS CRITICAL: ${maxTmpfsPercent}% — aborting session`);
        eventLogger.error("resources", "tmpfs.critical", `Tmpfs usage critical (${maxTmpfsPercent}%), aborting session`, usage);
      } else if (maxTmpfsPercent >= TMPFS_WARNING_THRESHOLD && !tmpfsWarningEmitted) {
        tmpfsWarningEmitted = true;
        console.warn(`[job:${jobId}] TMPFS WARNING: ${maxTmpfsPercent}% — attempting cleanup`);
        eventLogger.warn("resources", "tmpfs.warning", `Tmpfs usage high (${maxTmpfsPercent}%), attempting cleanup`, usage);
        await execInContainerWithTimeout(
          containerManager,
          containerId,
          ["sh", "-c", "rm -rf /home/opencode/.bun/install/cache 2>/dev/null"],
          "/",
          execTimeoutMs,
          "tmpfs cleanup",
        ).catch(() => undefined);
      }

      // Evaluate disk-backed workspace thresholds
      if (workspaceUsedMb !== undefined && workspaceUsedMb >= WORKSPACE_DISK_LIMIT_MB * WORKSPACE_DISK_CRITICAL_THRESHOLD) {
        critical = true;
        console.error(`[job:${jobId}] WORKSPACE DISK CRITICAL: ${workspaceUsedMb}MB / ${WORKSPACE_DISK_LIMIT_MB}MB — aborting session`);
        eventLogger.error("resources", "workspace.disk_critical", `Workspace disk usage critical (${workspaceUsedMb}MB), aborting session`, usage);
      } else if (workspaceUsedMb !== undefined && workspaceUsedMb >= WORKSPACE_DISK_LIMIT_MB * WORKSPACE_DISK_WARNING_THRESHOLD && !workspaceWarningEmitted) {
        workspaceWarningEmitted = true;
        console.warn(`[job:${jobId}] WORKSPACE DISK WARNING: ${workspaceUsedMb}MB / ${WORKSPACE_DISK_LIMIT_MB}MB — attempting cleanup`);
        eventLogger.warn("resources", "workspace.disk_warning", `Workspace disk usage high (${workspaceUsedMb}MB), attempting cleanup`, usage);
        await execInContainerWithTimeout(
          containerManager,
          containerId,
          ["sh", "-c", "cd /workspace/repo && git gc --auto 2>/dev/null"],
          "/",
          execTimeoutMs,
          "workspace cleanup",
        ).catch(() => undefined);
      }
    } catch {
      // Container may be stopping — non-fatal
    } finally {
      checkInFlight = false;
    }
  };

  const timer = setInterval(() => void check(), checkIntervalMs);
  // Run immediately on start
  void check();

  return {
    cleanup: () => clearInterval(timer),
    isCritical: () => critical,
  };
}

// ---------------------------------------------------------------------------
// logTmpfsUsage
// ---------------------------------------------------------------------------

/**
 * Log tmpfs and disk-backed workspace usage before container teardown.
 * Helps optimize SKILL_MEMORY_MAP allocations based on real usage data.
 */
export async function logTmpfsUsage(
  containerManager: ContainerManager,
  containerId: string,
  jobId: string,
  eventLogger: { info: (phase: string, eventType: string, message: string, payload: Record<string, unknown>) => void },
  jobContext?: {
    skillName: string;
    organizationId: string;
    workerId: string;
    workspaceMountMode: "bind" | "tmpfs";
  },
): Promise<void> {
  try {
    const usage: Record<string, { totalMb: number; usedMb: number; availableMb: number; usePercent: string }> = {};

    // tmpfs mounts (/tmp, /home/opencode) via df
    const { stdout: dfOutput } = await execInContainerWithTimeout(
      containerManager,
      containerId,
      ["df", "-m", "/tmp", "/home/opencode"],
      "/",
      RESOURCE_EXEC_TIMEOUT_MS,
      "teardown df /tmp /home/opencode",
    );
    const lines = dfOutput.split("\n").filter((l) => l.startsWith("tmpfs"));
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const mountPoint = parts[5];
        const label =
          mountPoint === "/tmp" ? "tmp" :
          mountPoint.startsWith("/home") ? "home" : mountPoint;
        usage[label] = {
          totalMb: parseInt(parts[1], 10),
          usedMb: parseInt(parts[2], 10),
          availableMb: parseInt(parts[3], 10),
          usePercent: parts[4],
        };
      }
    }

    // Disk-backed /workspace via du. Uses the larger workspace-specific
    // timeout for the same reasons as the in-flight watcher.
    try {
      const { stdout: duOutput } = await execInContainerWithTimeout(
        containerManager,
        containerId,
        ["du", "-sm", "/workspace"],
        "/",
        WORKSPACE_DU_TIMEOUT_MS,
        "teardown du -sm /workspace",
      );
      const duMatch = duOutput.match(/^(\d+)/);
      const usedMb = duMatch ? parseInt(duMatch[1], 10) : 0;
      usage.workspace = {
        totalMb: WORKSPACE_DISK_LIMIT_MB,
        usedMb,
        availableMb: WORKSPACE_DISK_LIMIT_MB - usedMb,
        usePercent: `${Math.round((usedMb / WORKSPACE_DISK_LIMIT_MB) * 100)}%`,
      };
    } catch {
      // /workspace may already be unmounted
    }

    console.log(`[job:${jobId}] resource usage at teardown:`, JSON.stringify(usage));
    eventLogger.info("resources", "tmpfs.usage", "Resource usage at job teardown", usage);

    // Emit to PostHog for resource usage dashboards
    if (jobContext) {
      const resources = getResourcesForTier(resolveResourceTier(resolveJobIntent({ promptTemplate: jobContext.skillName })));
      emitResourceUsage({
        jobId,
        skillName: jobContext.skillName,
        organizationId: jobContext.organizationId,
        workerId: jobContext.workerId,
        workspaceMountMode: jobContext.workspaceMountMode,
        memoryLimitMb: computeMemoryLimit(resources, jobContext.workspaceMountMode === "bind"),
        usage: Object.fromEntries(
          Object.entries(usage).map(([k, v]) => [k, { usedMb: v.usedMb, totalMb: v.totalMb }]),
        ),
      });
    }
  } catch {
    // Non-fatal: container may already be stopped
  }
}
