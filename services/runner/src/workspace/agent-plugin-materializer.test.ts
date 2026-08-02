import { describe, expect, it, mock } from "bun:test";
import { materializeAgentPlugins } from "./agent-plugin-materializer";

const portableReference = {
  id: "plugin-1",
  slug: "private-review",
  name: "Private review",
  kind: "portable_skill" as const,
  provider: "portable" as const,
  sourceType: "upload" as const,
  version: "1.2.3",
  checksumSha256: "a".repeat(64),
};

const descriptor = (
  files: Array<{ type: string; path: string; contentBase64: string }> = [
    {
      type: "file",
      path: "SKILL.md",
      contentBase64: Buffer.from("# Private review").toString("base64"),
    },
    {
      type: "file",
      path: "references/checklist.md",
      contentBase64: Buffer.from("- security").toString("base64"),
    },
  ],
) => ({
  schemaVersion: 1 as const,
  pluginId: portableReference.id,
  slug: portableReference.slug,
  kind: "portable_skill" as const,
  checksumSha256: portableReference.checksumSha256,
  files,
});

describe("materializeAgentPlugins", () => {
  it.each([
    ["claude-code", ".claude/skills/private-review"],
    ["codex", ".agents/skills/private-review"],
    ["opencode", ".agents/skills/private-review"],
  ] as const)(
    "materializes a portable bundle for %s in its provider skill directory",
    async (runtime, expectedRoot) => {
      const writes: Array<{ path: string; content: string; mode?: string }> = [];
      const downloadBundle = mock(async () => descriptor());

      const result = await materializeAgentPlugins({
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        runtime,
        references: [portableReference],
        downloadBundle,
        containerManager: {
          execInContainer: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          writeFileBufferViaExec: async (_containerId, path, content, mode) => {
            writes.push({ path, content: content.toString("utf8"), mode });
          },
        },
      });

      expect(downloadBundle).toHaveBeenCalledWith("plugin-1");
      expect(writes).toEqual([
        {
          path: `/workspace/repo/${expectedRoot}/SKILL.md`,
          content: "# Private review",
          mode: "0644",
        },
        {
          path: `/workspace/repo/${expectedRoot}/references/checklist.md`,
          content: "- security",
          mode: "0644",
        },
      ]);
      expect(result).toEqual({ pluginsMaterialized: 1, filesWritten: 2 });
    },
  );

  it("revalidates descriptor entry types and paths before writing", async () => {
    const writeFileBufferViaExec = mock(async () => {});

    await expect(
      materializeAgentPlugins({
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        runtime: "claude-code",
        references: [portableReference],
        downloadBundle: async () =>
          descriptor([
            {
              type: "symlink",
              path: "../escape",
              contentBase64: Buffer.from("/etc/passwd").toString("base64"),
            },
          ]),
        containerManager: {
          execInContainer: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          writeFileBufferViaExec,
        },
      }),
    ).rejects.toThrow("regular files");

    expect(writeFileBufferViaExec).not.toHaveBeenCalled();
  });

  it("bootstraps a native Claude marketplace before the first Claude CLI prompt", async () => {
    const downloadBundle = mock(async () => descriptor());
    const commands: string[][] = [];

    const result = await materializeAgentPlugins({
      containerId: "container-1",
      workspacePath: "/workspace/repo",
      runtime: "claude-code",
      references: [
        {
          id: "native-1",
          slug: "security-review",
          name: "Security review",
          kind: "claude_marketplace",
          provider: "claude-code",
          sourceType: "marketplace",
          version: "1.0.0",
          externalId: "security-review",
          marketplaceName: "claude-plugins-official",
          marketplaceSource: "anthropics/claude-plugins-official",
          resolution: "mutable_catalog",
        },
      ],
      downloadBundle,
      containerManager: {
        execInContainer: async (_containerId, command) => {
          commands.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        writeFileBufferViaExec: async () => {},
      },
    });

    expect(commands).toEqual([
      [
        "timeout",
        "60",
        "claude",
        "plugin",
        "marketplace",
        "add",
        "anthropics/claude-plugins-official",
        "--scope",
        "local",
      ],
      [
        "timeout",
        "120",
        "claude",
        "plugin",
        "install",
        "security-review@claude-plugins-official",
        "--scope",
        "local",
      ],
    ]);
    expect(result).toEqual({ pluginsMaterialized: 1, filesWritten: 0 });

    expect(downloadBundle).not.toHaveBeenCalled();
  });

  it("materializes an uploaded native Claude plugin as an isolated local marketplace", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const commands: string[][] = [];
    const nativeReference = {
      id: "native-upload-1",
      slug: "native-review",
      name: "Native review",
      kind: "claude_upload" as const,
      provider: "claude-code" as const,
      sourceType: "upload" as const,
      version: "1.0.0",
      pluginName: "native-review",
      checksumSha256: "b".repeat(64),
    };

    const result = await materializeAgentPlugins({
      containerId: "container-1",
      workspacePath: "/workspace/repo",
      runtime: "claude-code",
      references: [nativeReference],
      downloadBundle: async () => ({
        schemaVersion: 1,
        pluginId: nativeReference.id,
        slug: nativeReference.slug,
        kind: "claude_plugin",
        checksumSha256: nativeReference.checksumSha256,
        files: [
          {
            type: "file",
            path: ".claude-plugin/plugin.json",
            contentBase64: Buffer.from(
              JSON.stringify({ name: "native-review", version: "1.0.0" }),
            ).toString("base64"),
          },
        ],
      }),
      containerManager: {
        execInContainer: async (_containerId, command) => {
          commands.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        writeFileBufferViaExec: async (_containerId, path, content) => {
          writes.push({ path, content: content.toString("utf8") });
        },
      },
    });

    expect(writes.map((write) => write.path)).toEqual([
      "/workspace/repo/.almirant/plugin-marketplaces/native-review/plugins/native-review/.claude-plugin/plugin.json",
      "/workspace/repo/.almirant/plugin-marketplaces/native-review/.claude-plugin/marketplace.json",
    ]);
    expect(JSON.parse(writes[1]!.content)).toMatchObject({
      name: "almirant-native-review",
      plugins: [{ name: "native-review", source: "./plugins/native-review" }],
    });
    expect(commands).toEqual([
      [
        "test",
        "!",
        "-e",
        "/workspace/repo/.almirant/plugin-marketplaces/native-review",
      ],
      [
        "timeout",
        "60",
        "claude",
        "plugin",
        "marketplace",
        "add",
        "/workspace/repo/.almirant/plugin-marketplaces/native-review",
        "--scope",
        "local",
      ],
      [
        "timeout",
        "120",
        "claude",
        "plugin",
        "install",
        "native-review@almirant-native-review",
        "--scope",
        "local",
      ],
    ]);
    expect(result).toEqual({ pluginsMaterialized: 1, filesWritten: 2 });
  });

  it("keeps unsupported native Codex/OpenCode formats fail-closed", async () => {
    await expect(
      materializeAgentPlugins({
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        runtime: "codex",
        references: [
          {
            id: "native-codex-1",
            slug: "native-codex",
            name: "Native Codex",
            kind: "unsupported",
            provider: "codex",
            sourceType: "marketplace",
            diagnosticCode: "PROVIDER_MARKETPLACE_UNSUPPORTED",
            diagnostic: "Native Codex marketplace plugins are not supported.",
          },
        ],
        downloadBundle: async () => descriptor(),
        containerManager: {
          execInContainer: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          writeFileBufferViaExec: async () => {},
        },
      }),
    ).rejects.toThrow("PROVIDER_MARKETPLACE_UNSUPPORTED");
  });

  it("rejects API descriptors that do not match the pinned job reference", async () => {
    await expect(
      materializeAgentPlugins({
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        runtime: "claude-code",
        references: [portableReference],
        downloadBundle: async () => ({
          ...descriptor(),
          checksumSha256: "b".repeat(64),
        }),
        containerManager: {
          execInContainer: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          writeFileBufferViaExec: async () => {},
        },
      }),
    ).rejects.toThrow("checksum");
  });
});
