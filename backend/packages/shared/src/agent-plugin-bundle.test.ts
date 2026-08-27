import { describe, expect, it } from "bun:test";
import {
  decodeAgentPluginBundleDescriptor,
  decodePortableAgentPluginBundleDescriptor,
  PluginBundleValidationError,
  validateAgentPluginBundleFiles,
} from "./agent-plugin-bundle";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("agent plugin bundle validation", () => {
  it("accepts a portable root skill and reports compatible runtimes", () => {
    const result = validateAgentPluginBundleFiles([
      { path: "SKILL.md", content: bytes("# Review\nDo a careful review") },
      { path: "references/checklist.md", content: bytes("- security") },
    ]);

    expect(result.kind).toBe("portable_skill");
    expect(result.providers).toEqual(["claude-code", "codex", "opencode", "pi"]);
    expect(result.skillRoots).toEqual([""]);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it("decodes a canonical portable descriptor containing regular files only", () => {
    const result = decodePortableAgentPluginBundleDescriptor({
      schemaVersion: 1,
      kind: "portable_skill",
      files: [
        {
          type: "file",
          path: "SKILL.md",
          contentBase64: Buffer.from("# Review").toString("base64"),
        },
        {
          type: "file",
          path: "references/checklist.md",
          contentBase64: Buffer.from("- security").toString("base64"),
        },
      ],
    });

    expect(result.kind).toBe("portable_skill");
    expect(result.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/checklist.md",
    ]);
  });

  it.each([
    {
      name: "non-regular entry",
      descriptor: {
        schemaVersion: 1,
        kind: "portable_skill",
        files: [{ type: "symlink", path: "SKILL.md", contentBase64: "" }],
      },
    },
    {
      name: "non-canonical base64",
      descriptor: {
        schemaVersion: 1,
        kind: "portable_skill",
        files: [{ type: "file", path: "SKILL.md", contentBase64: "***" }],
      },
    },
    {
      name: "path traversal",
      descriptor: {
        schemaVersion: 1,
        kind: "portable_skill",
        files: [
          {
            type: "file",
            path: "../SKILL.md",
            contentBase64: Buffer.from("# escape").toString("base64"),
          },
        ],
      },
    },
  ])("rejects $name in canonical descriptors", ({ descriptor }) => {
    expect(() => decodePortableAgentPluginBundleDescriptor(descriptor)).toThrow(
      PluginBundleValidationError,
    );
  });

  it("accepts a native Claude plugin manifest", () => {
    const result = validateAgentPluginBundleFiles([
      {
        path: ".claude-plugin/plugin.json",
        content: bytes(JSON.stringify({ name: "private-review", version: "1.0.0" })),
      },
      { path: "skills/review/SKILL.md", content: bytes("# Review") },
    ]);

    expect(result).toMatchObject({
      kind: "claude_plugin",
      providers: ["claude-code"],
      pluginName: "private-review",
      version: "1.0.0",
    });
  });

  it("decodes a canonical native Claude plugin descriptor", () => {
    const result = decodeAgentPluginBundleDescriptor({
      schemaVersion: 1,
      kind: "claude_plugin",
      files: [
        {
          type: "file",
          path: ".claude-plugin/plugin.json",
          contentBase64: Buffer.from(
            JSON.stringify({ name: "private-review", version: "1.0.0" }),
          ).toString("base64"),
        },
      ],
    });

    expect(result).toMatchObject({
      kind: "claude_plugin",
      pluginName: "private-review",
      version: "1.0.0",
    });
  });

  it.each([
    "../escape.txt",
    "/absolute.txt",
    "folder/../../escape.txt",
    "folder\\windows.txt",
    "folder//empty.txt",
  ])("rejects zip-slip path %s", (path) => {
    expect(() =>
      validateAgentPluginBundleFiles([{ path, content: bytes("bad") }]),
    ).toThrow(PluginBundleValidationError);
  });

  it("rejects bundles with no supported plugin or skill entrypoint", () => {
    expect(() =>
      validateAgentPluginBundleFiles([
        { path: "README.md", content: bytes("not executable") },
      ]),
    ).toThrow("supported plugin entrypoint");
  });

  it("enforces file-count and uncompressed-size limits", () => {
    expect(() =>
      validateAgentPluginBundleFiles(
        Array.from({ length: 201 }, (_, index) => ({
          path: `files/${index}.txt`,
          content: bytes("x"),
        })),
      ),
    ).toThrow("200 files");

    expect(() =>
      validateAgentPluginBundleFiles(
        [{ path: "SKILL.md", content: new Uint8Array(101) }],
        { maxTotalBytes: 100 },
      ),
    ).toThrow("100 bytes");
  });
});
