import type { ErrorClassification } from "../shared/types";
import type { RunnableAgentWorkspace } from "./agent-workspace";
import type { CloneCredentialOutcome } from "./config-injector";

export type ServeReadinessAttributionParams = {
  workspaceKind: RunnableAgentWorkspace["kind"] | null | undefined;
  cloneCredential: CloneCredentialOutcome | undefined;
};

const CLONE_CREDENTIAL_CLASSIFICATION: ErrorClassification = "permanent_config";

/**
 * A serve-readiness failure on a git_repo workspace whose clone credential
 * was unavailable is not really a serve problem: the container's clone ran
 * anonymously, failed against the private repository, and the runtime never
 * started listening. Six minutes later the only visible symptom is a bare
 * "did not become ready" timeout (or a "never opened" early-exit) that says
 * nothing about the credential a "git.clone_credential_unavailable" event
 * already logged earlier — a log line the user has no reason to connect to
 * a timeout that follows minutes later. Attribute the failure explicitly so
 * the job's own error message carries the diagnosis.
 *
 * Mutates and returns the same Error instead of wrapping it, so any
 * properties other code depends on for retry/telemetry decisions (a
 * ManagedMcpReadinessError's `classification`, or a `phase_timeout` `code`)
 * survive untouched — this function only ever fires for a plain readiness
 * failure on a git_repo workspace, but staying non-destructive keeps that
 * true even if the call site changes.
 */
export const attributeServeReadinessFailure = (
  error: unknown,
  params: ServeReadinessAttributionParams,
): unknown => {
  if (params.workspaceKind !== "git_repo") return error;
  if (params.cloneCredential?.status !== "unavailable") return error;

  const attribution =
    ` — likely cause: the repository clone had no GitHub credential ` +
    `(${params.cloneCredential.reason}). Link the repository to a GitHub ` +
    `App installation in Settings > Integrations, then retry.`;

  const attributed =
    error instanceof Error
      ? error
      : new Error(String(error));
  attributed.message = `${attributed.message}${attribution}`;
  (attributed as Error & { classification?: ErrorClassification }).classification =
    CLONE_CREDENTIAL_CLASSIFICATION;
  return attributed;
};
