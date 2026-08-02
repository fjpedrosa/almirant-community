import {
  createOpenCodeSessionManager,
  type OpenCodeMcpStatus,
  type OpenCodeMcpStatusMap,
  type OpenCodeSessionManager,
} from "@almirant/remote-agent";
import { normalizeRunnerCustomMcpServersConfig } from "@almirant/shared";
import {
  classifyError,
  type ErrorClassification,
  isRecoverableError,
  type RuntimeType,
} from "../shared/types";

type ManagedMcpReadinessJob = {
  id: string;
  config?: Record<string, unknown> | null;
};

type ManagedMcpReadinessClient = Pick<
  OpenCodeSessionManager,
  "getMcpStatus"
>;

type ManagedMcpReadinessDependencies = {
  createClient: (
    config: Parameters<typeof createOpenCodeSessionManager>[0],
  ) => ManagedMcpReadinessClient;
};

type ManagedMcpReadinessInput = {
  job: ManagedMcpReadinessJob;
  runtimeType: RuntimeType;
  baseUrl: string;
  signal: AbortSignal;
};

export type ManagedMcpReadinessFailureReason =
  | "invalid_snapshot"
  | "runtime_request_failed"
  | "invalid_runtime_payload"
  | "not_connected";

const DEFAULT_MCP_READINESS_TIMEOUT_MS = 120_000;

const defaultDependencies: ManagedMcpReadinessDependencies = {
  createClient: (config) => createOpenCodeSessionManager(config),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeClassification = (
  error: unknown,
): ErrorClassification => {
  const classified = classifyError(
    error instanceof Error ? error : String(error),
  );
  return classified === "permanent_unknown"
    ? "recoverable_disconnect"
    : classified;
};

const classificationForStatus = (
  status: OpenCodeMcpStatus | undefined,
): ErrorClassification => {
  if (!status || status.status === "disabled") return "permanent_config";
  if (
    status.status === "needs_auth" ||
    status.status === "needs_client_registration"
  ) {
    return "permanent_auth";
  }
  if (status.status === "failed") {
    const message = String(status.error);
    if (/\b(?:401|403)\b|unauthorized|forbidden/i.test(message)) {
      return "permanent_auth";
    }
    if (/\b404\b/.test(message)) return "permanent_config";
    return normalizeClassification(status.error);
  }
  return "permanent_config";
};

const CLASSIFICATION_PRIORITY: Record<ErrorClassification, number> = {
  permanent_auth: 6,
  permanent_config: 5,
  recoverable_oom: 4,
  recoverable_timeout: 3,
  recoverable_disconnect: 2,
  permanent_unknown: 1,
};

export class ManagedMcpReadinessError extends Error {
  public readonly code = "managed_mcp_unavailable";

  constructor(
    public readonly reason: ManagedMcpReadinessFailureReason,
    public readonly serverNames: string[],
    public readonly classification: ErrorClassification,
    public readonly statuses?: Array<{ name: string; status: string }>,
  ) {
    super(
      `MANAGED_MCP_UNAVAILABLE: ${reason}` +
        (serverNames.length > 0
          ? ` (${serverNames.join(", ")})`
          : ""),
    );
    this.name = "ManagedMcpReadinessError";
  }
}

export const isRecoverableManagedMcpReadinessError = (
  error: unknown,
): error is ManagedMcpReadinessError =>
  error instanceof ManagedMcpReadinessError &&
  isRecoverableError(error.classification);

const invalidSnapshot = (
  serverNames: string[] = [],
): ManagedMcpReadinessError =>
  new ManagedMcpReadinessError(
    "invalid_snapshot",
    serverNames,
    "permanent_config",
  );

/**
 * Returns the immutable runtime names of every selected managed MCP profile.
 * This repeats the dispatch/config-injector equality fence intentionally: the
 * preflight must never silently skip a malformed required snapshot, while
 * preserving the legacy ignore behavior when no managed profile was selected.
 */
export const resolveRequiredManagedMcpServerNames = (
  job: ManagedMcpReadinessJob,
): string[] => {
  const config = job.config ?? {};
  const selectedIdsRaw = config.selectedMcpServerIds;
  const normalized = normalizeRunnerCustomMcpServersConfig(
    config.mcpServers,
  );

  const selectedIds = (() => {
    if (selectedIdsRaw === undefined) return null;
    if (
      !Array.isArray(selectedIdsRaw) ||
      selectedIdsRaw.some(
        (candidate) =>
          typeof candidate !== "string" || candidate.length === 0,
      ) ||
      new Set(selectedIdsRaw).size !== selectedIdsRaw.length
    ) {
      throw invalidSnapshot();
    }
    return selectedIdsRaw as string[];
  })();

  if (normalized.errors.length > 0) {
    if ((selectedIds?.length ?? 0) > 0) throw invalidSnapshot();
    return [];
  }

  const servers = normalized.servers ?? {};
  const names = Object.keys(servers).sort();
  const persistedIds = names.map(
    (name) => servers[name]!.almirantServerId!,
  );

  if (selectedIds === null) return names;
  const selectedSet = new Set(selectedIds);
  if (
    selectedSet.size !== persistedIds.length ||
    persistedIds.some((id) => !selectedSet.has(id))
  ) {
    throw invalidSnapshot(names);
  }

  return names;
};

const parseStatusMap = (value: unknown): OpenCodeMcpStatusMap | null => {
  if (!isRecord(value)) return null;
  for (const status of Object.values(value)) {
    if (!isRecord(status) || typeof status.status !== "string") {
      return null;
    }
    if (
      status.status !== "connected" &&
      status.status !== "disabled" &&
      status.status !== "failed" &&
      status.status !== "needs_auth" &&
      status.status !== "needs_client_registration"
    ) {
      return null;
    }
    if (
      (status.status === "failed" ||
        status.status === "needs_client_registration") &&
      typeof status.error !== "string"
    ) {
      return null;
    }
  }
  return value as OpenCodeMcpStatusMap;
};

export const assertRequiredManagedMcpReadiness = async (
  input: ManagedMcpReadinessInput,
  dependencies: ManagedMcpReadinessDependencies = defaultDependencies,
): Promise<void> => {
  input.signal.throwIfAborted();
  if (input.runtimeType !== "opencode") return;

  const serverNames = resolveRequiredManagedMcpServerNames(input.job);
  if (serverNames.length === 0) return;

  const client = dependencies.createClient({
    baseUrl: input.baseUrl,
    timeoutMs: DEFAULT_MCP_READINESS_TIMEOUT_MS,
  });
  const requestOptions = {
    signal: input.signal,
    timeoutMs: DEFAULT_MCP_READINESS_TIMEOUT_MS,
  };

  let rawStatuses: unknown;
  try {
    rawStatuses = await client.getMcpStatus(requestOptions);
  } catch (error) {
    input.signal.throwIfAborted();
    throw new ManagedMcpReadinessError(
      "runtime_request_failed",
      serverNames,
      normalizeClassification(error),
    );
  }
  input.signal.throwIfAborted();

  const statuses = parseStatusMap(rawStatuses);
  if (!statuses) {
    throw new ManagedMcpReadinessError(
      "invalid_runtime_payload",
      serverNames,
      "recoverable_disconnect",
    );
  }

  // OpenCode 1.18.4 only publishes "connected" after transport setup and
  // tool-definition cache initialization (including tools/list when the
  // server advertises tools). Its /experimental/tool/ids endpoint does NOT
  // include MCP tools, so status is the strongest truthful pre-prompt runtime
  // contract available without hardcoding a connector-specific list.
  const disconnected = serverNames.filter(
    (name) => statuses[name]?.status !== "connected",
  );
  if (disconnected.length > 0) {
    const statusSummary = disconnected.map((name) => ({
      name,
      status: statuses[name]?.status ?? "missing",
    }));
    const classification = disconnected.reduce<ErrorClassification>(
      (current, name) => {
        const next = classificationForStatus(statuses[name]);
        return CLASSIFICATION_PRIORITY[next] >
          CLASSIFICATION_PRIORITY[current]
          ? next
          : current;
      },
      "recoverable_disconnect",
    );
    throw new ManagedMcpReadinessError(
      "not_connected",
      disconnected,
      classification,
      statusSummary,
    );
  }
};
