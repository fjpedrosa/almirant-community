import path from "node:path";
import {
  decodeAgentPluginBundleDescriptor,
  decodePortableAgentPluginBundleDescriptor,
  type AgentRuntimePluginReference,
  type AgentPluginProvider,
  type ClaudeUploadedAgentRuntimePluginReference,
  type PortableAgentRuntimePluginReference,
} from "@almirant/shared";
import type { ContainerDriver } from "./container-driver";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MARKETPLACE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLUGIN_EXTERNAL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GITHUB_MARKETPLACE_SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type PluginContainerDriver = Pick<
  ContainerDriver,
  "execInContainer" | "writeFileBufferViaExec"
>;

export type MaterializeAgentPluginsInput = {
  containerId: string;
  workspacePath: string;
  runtime: AgentPluginProvider;
  references: AgentRuntimePluginReference[];
  downloadBundle: (pluginId: string) => Promise<unknown>;
  containerManager: PluginContainerDriver;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeMarketplaceSource = (rawSource: string): string | null => {
  const source = rawSource.trim();
  if (GITHUB_MARKETPLACE_SOURCE_RE.test(source)) return source;
  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const sanitizeCliDiagnostic = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|key|secret|auth)=)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

const runClaudePluginCommand = async (
  containerManager: PluginContainerDriver,
  containerId: string,
  workspacePath: string,
  command: string[],
  failureCode: string,
  allowAlreadyConfigured = false,
): Promise<void> => {
  const result = await containerManager.execInContainer(
    containerId,
    command,
    workspacePath,
  );
  if (result.exitCode === 0) return;

  const diagnostic = sanitizeCliDiagnostic(result.stderr || result.stdout);
  if (
    allowAlreadyConfigured &&
    /already\s+(?:exists|added|configured|installed)/i.test(diagnostic)
  ) {
    return;
  }

  throw new Error(
    `${failureCode}: Claude plugin bootstrap failed with exit ${result.exitCode}` +
      (diagnostic ? ` (${diagnostic})` : ""),
  );
};

const assertPortableReference = (
  reference: PortableAgentRuntimePluginReference,
): void => {
  if (
    reference.provider !== "portable" ||
    reference.sourceType !== "upload" ||
    !SAFE_SLUG_RE.test(reference.slug) ||
    !SHA256_RE.test(reference.checksumSha256)
  ) {
    throw new Error(
      `INVALID_PLUGIN_RUNTIME_CONFIGURATION: portable plugin ${reference.id} is invalid`,
    );
  }
};

const assertClaudeMarketplaceReference = (
  reference: Extract<AgentRuntimePluginReference, { kind: "claude_marketplace" }>,
): void => {
  if (
    reference.provider !== "claude-code" ||
    reference.sourceType !== "marketplace" ||
    reference.resolution !== "mutable_catalog" ||
    !SAFE_SLUG_RE.test(reference.slug) ||
    !MARKETPLACE_NAME_RE.test(reference.marketplaceName) ||
    !PLUGIN_EXTERNAL_ID_RE.test(reference.externalId) ||
    normalizeMarketplaceSource(reference.marketplaceSource) === null
  ) {
    throw new Error(
      `INVALID_PLUGIN_RUNTIME_CONFIGURATION: Claude marketplace plugin ${reference.id} is invalid`,
    );
  }
};

const assertClaudeUploadedReference = (
  reference: ClaudeUploadedAgentRuntimePluginReference,
): void => {
  if (
    reference.provider !== "claude-code" ||
    reference.sourceType !== "upload" ||
    !SAFE_SLUG_RE.test(reference.slug) ||
    !PLUGIN_EXTERNAL_ID_RE.test(reference.pluginName) ||
    !SHA256_RE.test(reference.checksumSha256)
  ) {
    throw new Error(
      `INVALID_PLUGIN_RUNTIME_CONFIGURATION: uploaded Claude plugin ${reference.id} is invalid`,
    );
  }
};

const skillDirectoryRoot = (
  workspacePath: string,
  runtime: AgentPluginProvider,
): string =>
  runtime === "claude-code"
    ? path.posix.join(workspacePath, ".claude/skills")
    : path.posix.join(workspacePath, ".agents/skills");

const filesForSkillRoot = (
  files: Array<{ path: string; content: Uint8Array }>,
  skillRoot: string,
): Array<{ relativePath: string; content: Uint8Array }> => {
  if (skillRoot === "") {
    return files.map((file) => ({ relativePath: file.path, content: file.content }));
  }

  const prefix = `${skillRoot}/`;
  return files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({
      relativePath: file.path.slice(prefix.length),
      content: file.content,
    }));
};

const materializePortableReference = async (input: {
  containerId: string;
  workspacePath: string;
  runtime: AgentPluginProvider;
  reference: PortableAgentRuntimePluginReference;
  downloadBundle: (pluginId: string) => Promise<unknown>;
  containerManager: PluginContainerDriver;
  claimedTargetRoots: Set<string>;
}): Promise<number> => {
  const descriptor = await input.downloadBundle(input.reference.id);
  const descriptorRecord = asRecord(descriptor);
  if (
    descriptorRecord?.pluginId !== input.reference.id ||
    descriptorRecord.slug !== input.reference.slug ||
    descriptorRecord.kind !== "portable_skill" ||
    typeof descriptorRecord.checksumSha256 !== "string" ||
    descriptorRecord.checksumSha256.toLowerCase() !==
      input.reference.checksumSha256.toLowerCase()
  ) {
    throw new Error(
      `PLUGIN_BUNDLE_PIN_MISMATCH: plugin ${input.reference.id} descriptor identity or checksum does not match the job pin`,
    );
  }

  // Revalidate file types, paths, duplicates and uncompressed limits at the
  // runner boundary even though the API already validated the descriptor.
  const validated = decodePortableAgentPluginBundleDescriptor(descriptor);
  const providerRoot = skillDirectoryRoot(input.workspacePath, input.runtime);
  const multipleSkills = validated.skillRoots.length > 1;
  let filesWritten = 0;

  for (const skillRoot of validated.skillRoots) {
    const sourceName = skillRoot === ""
      ? input.reference.slug
      : path.posix.basename(skillRoot);
    const targetName = multipleSkills
      ? `${input.reference.slug}-${sourceName}`.slice(0, 128)
      : input.reference.slug;
    if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(targetName)) {
      throw new Error(
        `INVALID_PLUGIN_SKILL_TARGET: plugin ${input.reference.id} produced an unsafe skill name`,
      );
    }

    const targetRoot = path.posix.join(providerRoot, targetName);
    if (input.claimedTargetRoots.has(targetRoot)) {
      throw new Error(
        `PLUGIN_SKILL_COLLISION: multiple selected plugins target ${targetName}`,
      );
    }
    input.claimedTargetRoots.add(targetRoot);

    const collisionCheck = await input.containerManager.execInContainer(
      input.containerId,
      ["test", "!", "-e", targetRoot],
      input.workspacePath,
    );
    if (collisionCheck.exitCode !== 0) {
      throw new Error(
        `PLUGIN_SKILL_COLLISION: refusing to overwrite existing skill ${targetName}`,
      );
    }

    for (const file of filesForSkillRoot(validated.files, skillRoot)) {
      const targetPath = path.posix.join(targetRoot, file.relativePath);
      if (!targetPath.startsWith(`${targetRoot}/`)) {
        throw new Error(
          `INVALID_PLUGIN_SKILL_TARGET: plugin ${input.reference.id} escaped its skill root`,
        );
      }
      await input.containerManager.writeFileBufferViaExec(
        input.containerId,
        targetPath,
        Buffer.from(file.content),
        "0644",
      );
      filesWritten += 1;
    }
  }

  return filesWritten;
};

const materializeClaudeUploadedReference = async (input: {
  containerId: string;
  workspacePath: string;
  reference: ClaudeUploadedAgentRuntimePluginReference;
  downloadBundle: (pluginId: string) => Promise<unknown>;
  containerManager: PluginContainerDriver;
  claimedTargetRoots: Set<string>;
}): Promise<number> => {
  const descriptor = await input.downloadBundle(input.reference.id);
  const descriptorRecord = asRecord(descriptor);
  if (
    descriptorRecord?.pluginId !== input.reference.id ||
    descriptorRecord.slug !== input.reference.slug ||
    descriptorRecord.kind !== "claude_plugin" ||
    typeof descriptorRecord.checksumSha256 !== "string" ||
    descriptorRecord.checksumSha256.toLowerCase() !==
      input.reference.checksumSha256.toLowerCase()
  ) {
    throw new Error(
      `PLUGIN_BUNDLE_PIN_MISMATCH: plugin ${input.reference.id} descriptor identity or checksum does not match the job pin`,
    );
  }

  const validated = decodeAgentPluginBundleDescriptor(descriptor);
  if (
    validated.kind !== "claude_plugin" ||
    validated.pluginName !== input.reference.pluginName
  ) {
    throw new Error(
      `PLUGIN_BUNDLE_PIN_MISMATCH: uploaded Claude plugin ${input.reference.id} manifest does not match the job pin`,
    );
  }

  const marketplaceRoot = path.posix.join(
    input.workspacePath,
    ".almirant/plugin-marketplaces",
    input.reference.slug,
  );
  if (input.claimedTargetRoots.has(marketplaceRoot)) {
    throw new Error(
      `CLAUDE_MARKETPLACE_NAME_COLLISION: duplicate uploaded plugin ${input.reference.slug}`,
    );
  }
  input.claimedTargetRoots.add(marketplaceRoot);

  const collisionCheck = await input.containerManager.execInContainer(
    input.containerId,
    ["test", "!", "-e", marketplaceRoot],
    input.workspacePath,
  );
  if (collisionCheck.exitCode !== 0) {
    throw new Error(
      `PLUGIN_SKILL_COLLISION: refusing to overwrite uploaded Claude plugin ${input.reference.slug}`,
    );
  }

  const pluginRoot = path.posix.join(
    marketplaceRoot,
    "plugins",
    input.reference.slug,
  );
  let filesWritten = 0;
  for (const file of validated.files) {
    const targetPath = path.posix.join(pluginRoot, file.path);
    if (!targetPath.startsWith(`${pluginRoot}/`)) {
      throw new Error(
        `INVALID_PLUGIN_SKILL_TARGET: plugin ${input.reference.id} escaped its plugin root`,
      );
    }
    await input.containerManager.writeFileBufferViaExec(
      input.containerId,
      targetPath,
      Buffer.from(file.content),
      "0644",
    );
    filesWritten += 1;
  }

  const marketplaceName = `almirant-${input.reference.slug}`;
  const marketplaceManifestPath = path.posix.join(
    marketplaceRoot,
    ".claude-plugin/marketplace.json",
  );
  const marketplaceManifest = Buffer.from(
    JSON.stringify({
      name: marketplaceName,
      owner: { name: "Almirant user storage" },
      plugins: [
        {
          name: input.reference.pluginName,
          source: `./plugins/${input.reference.slug}`,
        },
      ],
    }),
  );
  await input.containerManager.writeFileBufferViaExec(
    input.containerId,
    marketplaceManifestPath,
    marketplaceManifest,
    "0644",
  );
  filesWritten += 1;

  await runClaudePluginCommand(
    input.containerManager,
    input.containerId,
    input.workspacePath,
    [
      "timeout",
      "60",
      "claude",
      "plugin",
      "marketplace",
      "add",
      marketplaceRoot,
      "--scope",
      "local",
    ],
    "CLAUDE_MARKETPLACE_ADD_FAILED",
  );
  await runClaudePluginCommand(
    input.containerManager,
    input.containerId,
    input.workspacePath,
    [
      "timeout",
      "120",
      "claude",
      "plugin",
      "install",
      `${input.reference.pluginName}@${marketplaceName}`,
      "--scope",
      "local",
    ],
    "CLAUDE_PLUGIN_INSTALL_FAILED",
  );

  return filesWritten;
};

export const materializeAgentPlugins = async ({
  containerId,
  workspacePath,
  runtime,
  references,
  downloadBundle,
  containerManager,
}: MaterializeAgentPluginsInput): Promise<{
  pluginsMaterialized: number;
  filesWritten: number;
}> => {
  if (references.length > 50) {
    throw new Error("INVALID_PLUGIN_RUNTIME_CONFIGURATION: too many plugins selected");
  }

  // Validate every reference before performing any side effect. Unsupported
  // provider-native formats always fail closed with their persisted diagnostic.
  for (const reference of references) {
    if (reference.kind === "unsupported") {
      throw new Error(`${reference.diagnosticCode}: ${reference.diagnostic}`);
    }
    if (reference.kind === "portable_skill") {
      assertPortableReference(reference);
      continue;
    }
    if (reference.kind === "claude_upload") {
      assertClaudeUploadedReference(reference);
      if (runtime !== "claude-code") {
        throw new Error(
          `PLUGIN_PROVIDER_MISMATCH: uploaded Claude plugin ${reference.id} cannot run on ${runtime}`,
        );
      }
      continue;
    }
    assertClaudeMarketplaceReference(reference);
    if (runtime !== "claude-code") {
      throw new Error(
        `PLUGIN_PROVIDER_MISMATCH: Claude marketplace plugin ${reference.id} cannot run on ${runtime}`,
      );
    }
  }

  const addedMarketplaces = new Map<string, string>();
  let pluginsMaterialized = 0;
  let filesWritten = 0;

  for (const reference of references) {
    if (reference.kind !== "claude_marketplace") continue;
    const source = normalizeMarketplaceSource(reference.marketplaceSource)!;
    const existingSource = addedMarketplaces.get(reference.marketplaceName);
    if (existingSource && existingSource !== source) {
      throw new Error(
        `CLAUDE_MARKETPLACE_NAME_COLLISION: ${reference.marketplaceName} resolves to multiple sources`,
      );
    }

    if (!existingSource) {
      await runClaudePluginCommand(
        containerManager,
        containerId,
        workspacePath,
        [
          "timeout",
          "60",
          "claude",
          "plugin",
          "marketplace",
          "add",
          source,
          "--scope",
          "local",
        ],
        "CLAUDE_MARKETPLACE_ADD_FAILED",
        true,
      );
      addedMarketplaces.set(reference.marketplaceName, source);
    }

    await runClaudePluginCommand(
      containerManager,
      containerId,
      workspacePath,
      [
        "timeout",
        "120",
        "claude",
        "plugin",
        "install",
        `${reference.externalId}@${reference.marketplaceName}`,
        "--scope",
        "local",
      ],
      "CLAUDE_PLUGIN_INSTALL_FAILED",
    );
    pluginsMaterialized += 1;
  }

  const claimedTargetRoots = new Set<string>();
  for (const reference of references) {
    if (reference.kind !== "claude_upload") continue;
    filesWritten += await materializeClaudeUploadedReference({
      containerId,
      workspacePath,
      reference,
      downloadBundle,
      containerManager,
      claimedTargetRoots,
    });
    pluginsMaterialized += 1;
  }

  for (const reference of references) {
    if (reference.kind !== "portable_skill") continue;
    filesWritten += await materializePortableReference({
      containerId,
      workspacePath,
      runtime,
      reference,
      downloadBundle,
      containerManager,
      claimedTargetRoots,
    });
    pluginsMaterialized += 1;
  }

  return { pluginsMaterialized, filesWritten };
};
