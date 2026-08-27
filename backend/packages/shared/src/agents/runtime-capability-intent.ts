import {
  runtimeCapabilityRegistry,
  type RuntimeAuthClass,
  type RuntimeCapabilityId,
} from "./runtime-capability-registry";

export const RUNTIME_CAPABILITY_INTENT_MALFORMED =
  "RUNTIME_CAPABILITY_INTENT_MALFORMED" as const;

export type RuntimeCapabilityIntentErrorCode =
  | typeof RUNTIME_CAPABILITY_INTENT_MALFORMED
  | "RUNTIME_AUTH_CLASS_UNSUPPORTED"
  | "RUNTIME_CAPABILITY_UNSUPPORTED";

export type RuntimeCapabilityIntentField =
  | "config"
  | "authClass"
  | "runtimeAuthClass"
  | "capabilities"
  | "mcpServerUrl"
  | "mcpServers"
  | "selectedMcpServerIds"
  | "workspaceIntent"
  | "requiresEnforcedReadOnlyRuntime"
  | "readOnlyEnforced"
  | "requiresReadOnlyEnforcement"
  | "permissionEnforced"
  | "requiresPermissionEnforcement"
  | "requiresEnforcedPermissions"
  | "permissionMode"
  | "needsBrowser"
  | "requiresBrowser"
  | "enableBrowser"
  | "resourceProfile"
  | "resourceRequirements";

export type RuntimeCapabilityIntent = Readonly<{
  authClass: RuntimeAuthClass | null;
  capabilities: readonly RuntimeCapabilityId[];
}>;

export type RuntimeCapabilityIntentResult =
  | Readonly<{ ok: true; intent: RuntimeCapabilityIntent }>
  | Readonly<{
      ok: false;
      code: RuntimeCapabilityIntentErrorCode;
      field: RuntimeCapabilityIntentField;
    }>;

/** Typed enqueue failure with a bounded message that never reflects config data. */
export class RuntimeCapabilityIntentError extends Error {
  constructor(
    readonly code: RuntimeCapabilityIntentErrorCode,
    readonly field: RuntimeCapabilityIntentField,
  ) {
    super(`Invalid runtime capability intent: ${code} (${field})`);
    this.name = "RuntimeCapabilityIntentError";
  }
}

const MAX_MCP_SERVERS = 20;
const MAX_SELECTED_MCP_IDS = 64;
const MAX_EXPLICIT_CAPABILITIES = 16;
const MAX_INTENT_STRING_LENGTH = 2_048;

const BROWSER_MARKERS = [
  "needsBrowser",
  "requiresBrowser",
  "enableBrowser",
] as const;
const NESTED_BROWSER_CONTAINERS = [
  "resourceProfile",
  "resourceRequirements",
] as const;
const READ_ONLY_MARKERS = [
  "requiresEnforcedReadOnlyRuntime",
  "readOnlyEnforced",
  "requiresReadOnlyEnforcement",
] as const;
const PERMISSION_MARKERS = [
  "permissionEnforced",
  "requiresPermissionEnforcement",
  "requiresEnforcedPermissions",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rejected = (
  code: RuntimeCapabilityIntentErrorCode,
  field: RuntimeCapabilityIntentField,
): RuntimeCapabilityIntentResult => Object.freeze({ ok: false, code, field });

const readBooleanMarker = (
  record: Record<string, unknown>,
  field: RuntimeCapabilityIntentField,
): boolean | null | RuntimeCapabilityIntentResult => {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
  }
  return value;
};

const readAuthClass = (
  config: Record<string, unknown>,
): RuntimeAuthClass | null | RuntimeCapabilityIntentResult => {
  const candidates = ["authClass", "runtimeAuthClass"] as const;
  let selected: RuntimeAuthClass | null = null;

  for (const field of candidates) {
    const value = config[field];
    if (value === undefined || value === null) continue;
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_INTENT_STRING_LENGTH
    ) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
    }
    if (
      !runtimeCapabilityRegistry.authClasses.some(
        (authClass) => authClass === value,
      )
    ) {
      return rejected("RUNTIME_AUTH_CLASS_UNSUPPORTED", field);
    }
    if (selected !== null && selected !== value) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
    }
    selected = value as RuntimeAuthClass;
  }

  return selected;
};

const addExplicitCapabilities = (
  config: Record<string, unknown>,
  capabilities: Set<RuntimeCapabilityId>,
): RuntimeCapabilityIntentResult | null => {
  const value = config.capabilities;
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_EXPLICIT_CAPABILITIES) {
    return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "capabilities");
  }

  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_INTENT_STRING_LENGTH
    ) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "capabilities");
    }
    const capability = runtimeCapabilityRegistry.capabilityIds.find(
      (entry) => entry === candidate,
    );
    if (!capability) {
      return rejected("RUNTIME_CAPABILITY_UNSUPPORTED", "capabilities");
    }
    capabilities.add(capability);
  }

  return null;
};

const addMcpIntent = (
  config: Record<string, unknown>,
  capabilities: Set<RuntimeCapabilityId>,
): RuntimeCapabilityIntentResult | null => {
  const mcpServerUrl = config.mcpServerUrl;
  if (mcpServerUrl !== undefined && mcpServerUrl !== null) {
    if (
      typeof mcpServerUrl !== "string" ||
      mcpServerUrl.length === 0 ||
      mcpServerUrl.length > MAX_INTENT_STRING_LENGTH
    ) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "mcpServerUrl");
    }
    capabilities.add("mcp");
  }

  const mcpServers = config.mcpServers;
  if (mcpServers !== undefined && mcpServers !== null) {
    if (!isRecord(mcpServers)) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "mcpServers");
    }
    const serverNames = Object.keys(mcpServers);
    if (serverNames.length > MAX_MCP_SERVERS) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "mcpServers");
    }
    if (serverNames.length > 0) capabilities.add("mcp");
  }

  const selectedMcpServerIds = config.selectedMcpServerIds;
  if (selectedMcpServerIds !== undefined && selectedMcpServerIds !== null) {
    if (
      !Array.isArray(selectedMcpServerIds) ||
      selectedMcpServerIds.length > MAX_SELECTED_MCP_IDS ||
      selectedMcpServerIds.some(
        (candidate) =>
          typeof candidate !== "string" ||
          candidate.length === 0 ||
          candidate.length > MAX_INTENT_STRING_LENGTH,
      ) ||
      new Set(selectedMcpServerIds).size !== selectedMcpServerIds.length
    ) {
      return rejected(
        RUNTIME_CAPABILITY_INTENT_MALFORMED,
        "selectedMcpServerIds",
      );
    }
    if (selectedMcpServerIds.length > 0) capabilities.add("mcp");
  }

  return null;
};

const addBrowserIntent = (
  config: Record<string, unknown>,
  capabilities: Set<RuntimeCapabilityId>,
): RuntimeCapabilityIntentResult | null => {
  for (const marker of BROWSER_MARKERS) {
    const value = readBooleanMarker(config, marker);
    if (typeof value === "object" && value !== null) return value;
    if (value === true) capabilities.add("browser");
  }

  for (const containerField of NESTED_BROWSER_CONTAINERS) {
    const nested = config[containerField];
    if (nested === undefined || nested === null) continue;
    if (!isRecord(nested)) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, containerField);
    }
    for (const marker of BROWSER_MARKERS) {
      const value = readBooleanMarker(nested, marker);
      if (typeof value === "object" && value !== null) return value;
      if (value === true) capabilities.add("browser");
    }
  }

  return null;
};

const addWorkspaceAndPermissionIntent = (
  config: Record<string, unknown>,
  capabilities: Set<RuntimeCapabilityId>,
): RuntimeCapabilityIntentResult | null => {
  const workspaceIntent = config.workspaceIntent;
  if (workspaceIntent !== undefined && workspaceIntent !== null) {
    if (workspaceIntent !== "read-only" && workspaceIntent !== "write") {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "workspaceIntent");
    }
    if (workspaceIntent === "read-only") capabilities.add("read_only_enforced");
  }

  if (
    config.requiresEnforcedReadOnlyRuntime === true &&
    workspaceIntent !== "read-only"
  ) {
    return rejected(
      RUNTIME_CAPABILITY_INTENT_MALFORMED,
      "requiresEnforcedReadOnlyRuntime",
    );
  }

  for (const marker of READ_ONLY_MARKERS) {
    const value = readBooleanMarker(config, marker);
    if (typeof value === "object" && value !== null) return value;
    if (value === true) capabilities.add("read_only_enforced");
  }

  for (const marker of PERMISSION_MARKERS) {
    const value = readBooleanMarker(config, marker);
    if (typeof value === "object" && value !== null) return value;
    if (value === true) capabilities.add("permission_enforced");
  }

  const permissionMode = config.permissionMode;
  if (permissionMode !== undefined && permissionMode !== null) {
    if (
      typeof permissionMode !== "string" ||
      permissionMode.length === 0 ||
      permissionMode.length > MAX_INTENT_STRING_LENGTH
    ) {
      return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "permissionMode");
    }
    capabilities.add("permission_enforced");
  }

  return null;
};

/**
 * Read only the bounded set of job-config fields that can express runtime auth
 * or optional capabilities. Unknown unrelated config remains open, while a
 * malformed known field fails closed instead of degrading to no capabilities.
 */
export const deriveRuntimeCapabilityIntent = (
  input: unknown,
): RuntimeCapabilityIntentResult => {
  if (!isRecord(input)) {
    return rejected(RUNTIME_CAPABILITY_INTENT_MALFORMED, "config");
  }

  const authClass = readAuthClass(input);
  if (typeof authClass === "object" && authClass !== null) return authClass;

  const capabilities = new Set<RuntimeCapabilityId>();
  for (const derive of [
    addExplicitCapabilities,
    addMcpIntent,
    addBrowserIntent,
    addWorkspaceAndPermissionIntent,
  ] as const) {
    const failure = derive(input, capabilities);
    if (failure) return failure;
  }

  const canonicalCapabilities = runtimeCapabilityRegistry.capabilityIds.filter(
    (capability) => capabilities.has(capability),
  );
  const intent: RuntimeCapabilityIntent = Object.freeze({
    authClass,
    capabilities: Object.freeze([...canonicalCapabilities]),
  });
  return Object.freeze({ ok: true, intent });
};
