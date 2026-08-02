import type { RuntimeType } from "../shared/types";
import { sanitizeLogContent } from "../observability/log-sanitizer";
import { resolveJobIntent } from "../orchestration/job-intent";
import type { ContainerDriver } from "./container-driver";

export type RuntimeCapability = "browser";

type RuntimeCapabilityJob = Parameters<typeof resolveJobIntent>[0];

type RuntimeCapabilityPreflightInput = {
  job: RuntimeCapabilityJob;
  runtimeType: RuntimeType;
  containerId: string;
  workspacePath: string;
  containerManager: Pick<ContainerDriver, "execInContainer">;
};

const RUNTIME_CAPABILITY_PROBE =
  "/usr/local/bin/almirant-runtime-capability-check";
const PROBE_COMMAND = [
  RUNTIME_CAPABILITY_PROBE,
  "browser",
  "--json",
  "--expected-uid=1001",
] as const;

const diagnosticFrom = (...parts: string[]): string => {
  const diagnostic = sanitizeLogContent(
    parts.filter(Boolean).join("\n"),
  ).replace(/\s+/g, " ").trim();
  return diagnostic.slice(0, 500);
};

export class RuntimeCapabilityMissingError extends Error {
  public readonly code = "runtime_capability_missing";
  public readonly classification = "permanent_config";

  constructor(
    public readonly capability: RuntimeCapability,
    public readonly runtimeType: RuntimeType,
    diagnostic?: string,
  ) {
    super(
      `RUNTIME_CAPABILITY_MISSING: ${capability} is unavailable for runtime ${runtimeType}` +
        (diagnostic ? ` (${diagnostic})` : ""),
    );
    this.name = "RuntimeCapabilityMissingError";
  }
}

export const resolveRequiredRuntimeCapabilities = (
  job: RuntimeCapabilityJob,
): RuntimeCapability[] =>
  resolveJobIntent(job).needsBrowser ? ["browser"] : [];

const assertBrowserProbeResult = (
  runtimeType: RuntimeType,
  result: { exitCode: number; stdout: string; stderr: string },
): void => {
  if (result.exitCode !== 0) {
    throw new RuntimeCapabilityMissingError(
      "browser",
      runtimeType,
      diagnosticFrom(result.stderr, result.stdout),
    );
  }

  try {
    const payload = JSON.parse(result.stdout) as {
      capability?: unknown;
      status?: unknown;
    };
    if (payload.capability !== "browser" || payload.status !== "ok") {
      throw new Error("probe returned an invalid success payload");
    }
  } catch (error) {
    throw new RuntimeCapabilityMissingError(
      "browser",
      runtimeType,
      diagnosticFrom(
        error instanceof Error ? error.message : String(error),
        result.stdout,
      ),
    );
  }
};

export const assertRequiredRuntimeCapabilities = async (
  input: RuntimeCapabilityPreflightInput,
): Promise<void> => {
  const requiredCapabilities = resolveRequiredRuntimeCapabilities(input.job);
  if (!requiredCapabilities.includes("browser")) return;

  try {
    const result = await input.containerManager.execInContainer(
      input.containerId,
      [...PROBE_COMMAND],
      input.workspacePath,
    );
    assertBrowserProbeResult(input.runtimeType, result);
  } catch (error) {
    if (error instanceof RuntimeCapabilityMissingError) throw error;
    throw new RuntimeCapabilityMissingError(
      "browser",
      input.runtimeType,
      diagnosticFrom(error instanceof Error ? error.message : String(error)),
    );
  }
};
