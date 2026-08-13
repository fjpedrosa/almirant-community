export const AGENT_JOB_ARCHIVE_KIND = {
  nativeEvents: "native_events",
} as const;

const IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const requireIdentifier = (value: string, label: string): string => {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid archive identifier (${label}): ${value}`);
  }
  return value;
};

/**
 * Cloud keeps every tenant under its own prefix; a self-hosted instance with no
 * workspace keeps the flat layout its existing archives already use.
 */
export const buildNativeEventsArchiveKey = (
  agentJobId: string,
  workspaceId: string | null,
): string => {
  const job = requireIdentifier(agentJobId, "agentJobId");
  const suffix = `agent-jobs/${job}/${AGENT_JOB_ARCHIVE_KIND.nativeEvents}.ndjson.gz`;

  if (!workspaceId) return suffix;

  return `workspaces/${requireIdentifier(workspaceId, "workspaceId")}/${suffix}`;
};
