export type AgentPluginProvider = "claude-code" | "codex" | "opencode";
export type AgentPluginBundleKind = "portable_skill" | "claude_plugin";

export type AgentRuntimePluginProvider = "portable" | AgentPluginProvider;
export type AgentRuntimePluginSourceType = "upload" | "marketplace";

export interface PortableAgentRuntimePluginReference {
  id: string;
  slug: string;
  name: string;
  kind: "portable_skill";
  provider: "portable";
  sourceType: "upload";
  version?: string;
  checksumSha256: string;
}

export interface ClaudeMarketplaceAgentRuntimePluginReference {
  id: string;
  slug: string;
  name: string;
  kind: "claude_marketplace";
  provider: "claude-code";
  sourceType: "marketplace";
  version?: string;
  externalId: string;
  marketplaceName: string;
  marketplaceSource: string;
  /** Catalog/package bytes are not integrity-pinned; install only in a per-job isolated HOME. */
  resolution: "mutable_catalog";
}

export interface ClaudeUploadedAgentRuntimePluginReference {
  id: string;
  slug: string;
  name: string;
  kind: "claude_upload";
  provider: "claude-code";
  sourceType: "upload";
  version?: string;
  pluginName: string;
  checksumSha256: string;
}

export interface UnsupportedAgentRuntimePluginReference {
  id: string;
  slug: string;
  name: string;
  kind: "unsupported";
  provider: AgentRuntimePluginProvider;
  sourceType: AgentRuntimePluginSourceType;
  version?: string;
  diagnosticCode:
    | "NATIVE_PLUGIN_UPLOAD_UNSUPPORTED"
    | "PROVIDER_MARKETPLACE_UNSUPPORTED"
    | "INVALID_PLUGIN_RUNTIME_CONFIGURATION";
  diagnostic: string;
}

export type AgentRuntimePluginReference =
  | PortableAgentRuntimePluginReference
  | ClaudeMarketplaceAgentRuntimePluginReference
  | ClaudeUploadedAgentRuntimePluginReference
  | UnsupportedAgentRuntimePluginReference;

export interface AgentPluginBundleDescriptorFile {
  /** Only regular files are accepted. Archives, links and device entries are never materialized. */
  type: "file";
  path: string;
  contentBase64: string;
}

/** Canonical object stored in the user's private object-storage allocation. */
export interface StoredPortableAgentPluginBundleDescriptor {
  schemaVersion: 1;
  kind: "portable_skill";
  files: AgentPluginBundleDescriptorFile[];
}

/** Validated worker response. The job-pinned identity fields are added by the API. */
export interface PortableAgentPluginBundleDescriptor
  extends StoredPortableAgentPluginBundleDescriptor {
  pluginId: string;
  slug: string;
  checksumSha256: string;
}

export interface AgentPluginBundleFile {
  path: string;
  content: Uint8Array;
}

export interface AgentPluginBundleValidationOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

export interface ValidatedAgentPluginBundle {
  kind: AgentPluginBundleKind;
  providers: AgentPluginProvider[];
  files: AgentPluginBundleFile[];
  totalBytes: number;
  skillRoots: string[];
  pluginName: string | null;
  version: string | null;
}

export class PluginBundleValidationError extends Error {
  readonly code = "INVALID_AGENT_PLUGIN_BUNDLE";

  constructor(message: string) {
    super(message);
    this.name = "PluginBundleValidationError";
  }
}

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const normalizeBundlePath = (rawPath: string): string => {
  const path = rawPath.trim();
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    CONTROL_CHARACTER_RE.test(path)
  ) {
    throw new PluginBundleValidationError(`Unsafe plugin bundle path: ${rawPath}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PluginBundleValidationError(`Unsafe plugin bundle path: ${rawPath}`);
  }
  if (path.length > 512 || segments.some((segment) => segment.length > 128)) {
    throw new PluginBundleValidationError(`Plugin bundle path is too long: ${rawPath}`);
  }
  return segments.join("/");
};

const findSkillRoot = (path: string): string | null => {
  if (path === "SKILL.md") return "";
  const match = /^(.*(?:^|\/)skills\/[^/]+)\/SKILL\.md$/.exec(path);
  return match?.[1] ?? null;
};

export const validateAgentPluginBundleFiles = (
  inputFiles: AgentPluginBundleFile[],
  options: AgentPluginBundleValidationOptions = {},
): ValidatedAgentPluginBundle => {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (inputFiles.length === 0) {
    throw new PluginBundleValidationError("Plugin bundle is empty");
  }
  if (inputFiles.length > maxFiles) {
    throw new PluginBundleValidationError(`Plugin bundle cannot contain more than ${maxFiles} files`);
  }

  let totalBytes = 0;
  const seenPaths = new Set<string>();
  const files = inputFiles.map((input) => {
    const path = normalizeBundlePath(input.path);
    if (seenPaths.has(path)) {
      throw new PluginBundleValidationError(`Plugin bundle contains duplicate path: ${path}`);
    }
    seenPaths.add(path);
    if (!(input.content instanceof Uint8Array)) {
      throw new PluginBundleValidationError(`Plugin bundle file is not binary data: ${path}`);
    }
    if (input.content.byteLength > maxFileBytes) {
      throw new PluginBundleValidationError(`Plugin bundle file exceeds ${maxFileBytes} bytes: ${path}`);
    }
    totalBytes += input.content.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new PluginBundleValidationError(`Plugin bundle exceeds ${maxTotalBytes} bytes`);
    }
    return { path, content: input.content };
  });

  const manifestFile = files.find((file) => file.path === ".claude-plugin/plugin.json");
  if (manifestFile) {
    let manifest: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(manifestFile.content));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      manifest = parsed as Record<string, unknown>;
    } catch {
      throw new PluginBundleValidationError("Claude plugin manifest is invalid JSON");
    }
    const pluginName = typeof manifest.name === "string" ? manifest.name.trim() : "";
    if (!PLUGIN_NAME_RE.test(pluginName)) {
      throw new PluginBundleValidationError("Claude plugin manifest has an invalid name");
    }
    const version = typeof manifest.version === "string"
      ? manifest.version.trim().slice(0, 100) || null
      : null;
    return {
      kind: "claude_plugin",
      providers: ["claude-code"],
      files,
      totalBytes,
      skillRoots: files.map((file) => findSkillRoot(file.path)).filter((root): root is string => root !== null),
      pluginName,
      version,
    };
  }

  const skillRoots = Array.from(
    new Set(
      files
        .map((file) => findSkillRoot(file.path))
        .filter((root): root is string => root !== null),
    ),
  );
  if (skillRoots.length === 0) {
    throw new PluginBundleValidationError(
      "Plugin bundle does not contain a supported plugin entrypoint (SKILL.md or .claude-plugin/plugin.json)",
    );
  }

  return {
    kind: "portable_skill",
    providers: ["claude-code", "codex", "opencode"],
    files,
    totalBytes,
    skillRoots,
    pluginName: null,
    version: null,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const decodeCanonicalBase64 = (
  contentBase64: string,
  path: string,
  maxFileBytes: number,
): Uint8Array => {
  const maxEncodedLength = Math.ceil(maxFileBytes / 3) * 4;
  if (contentBase64.length > maxEncodedLength) {
    throw new PluginBundleValidationError(
      `Plugin bundle file exceeds ${maxFileBytes} bytes: ${path}`,
    );
  }
  if (
    contentBase64.length % 4 !== 0 ||
    !CANONICAL_BASE64_RE.test(contentBase64)
  ) {
    throw new PluginBundleValidationError(
      `Plugin bundle file has invalid base64 content: ${path}`,
    );
  }

  const content = Buffer.from(contentBase64, "base64");
  if (content.toString("base64") !== contentBase64) {
    throw new PluginBundleValidationError(
      `Plugin bundle file has non-canonical base64 content: ${path}`,
    );
  }
  return content;
};

/**
 * Decodes and revalidates the canonical descriptor used between object storage,
 * the worker API and the runner. It deliberately accepts regular files only;
 * raw archive entries are never extracted by this path.
 */
export const decodeAgentPluginBundleDescriptor = (
  input: unknown,
  options: AgentPluginBundleValidationOptions = {},
): ValidatedAgentPluginBundle => {
  const descriptor = asRecord(input);
  if (
    descriptor?.schemaVersion !== 1 ||
    (descriptor.kind !== "portable_skill" && descriptor.kind !== "claude_plugin") ||
    !Array.isArray(descriptor.files)
  ) {
    throw new PluginBundleValidationError(
      "Portable plugin bundle descriptor is invalid",
    );
  }

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (descriptor.files.length > maxFiles) {
    throw new PluginBundleValidationError(
      `Plugin bundle cannot contain more than ${maxFiles} files`,
    );
  }

  const files = descriptor.files.map((rawFile, index) => {
    const file = asRecord(rawFile);
    if (file?.type !== "file") {
      throw new PluginBundleValidationError(
        `Plugin bundle descriptors may contain regular files only (entry ${index})`,
      );
    }
    if (typeof file.path !== "string" || typeof file.contentBase64 !== "string") {
      throw new PluginBundleValidationError(
        `Plugin bundle file descriptor is invalid (entry ${index})`,
      );
    }

    return {
      path: file.path,
      content: decodeCanonicalBase64(file.contentBase64, file.path, maxFileBytes),
    };
  });

  const validated = validateAgentPluginBundleFiles(files, options);
  if (validated.kind !== descriptor.kind) {
    throw new PluginBundleValidationError(
      "Plugin bundle descriptor kind does not match its validated entrypoint",
    );
  }
  return validated;
};

export const decodePortableAgentPluginBundleDescriptor = (
  input: unknown,
  options: AgentPluginBundleValidationOptions = {},
): ValidatedAgentPluginBundle => {
  const validated = decodeAgentPluginBundleDescriptor(input, options);
  if (validated.kind !== "portable_skill") {
    throw new PluginBundleValidationError(
      "Native plugin bundles cannot be materialized as portable skills",
    );
  }
  return validated;
};
