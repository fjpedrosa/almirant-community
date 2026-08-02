import { afterEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import {
  materializeSelectedSkills,
  parseSelectedSkillReferences,
  resolveSkillFromDb,
} from "./skill-resolver";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const eventLogger = {
  info: () => {},
  warn: () => {},
} as never;

const skillContent = "# Scrape bundle";
const skillContentHash = createHash("sha256")
  .update(skillContent)
  .digest("hex");

const makeSkillResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      success: true,
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "scrape-bundle",
        content: skillContent,
        version: 3,
        contentHash: skillContentHash,
        ...overrides,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

describe("selected skill snapshots", () => {
  it("rejects malformed or duplicate pinned references before any API request", () => {
    expect(() =>
      parseSelectedSkillReferences([
        {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "scrape-bundle",
          version: 3,
          contentHash: "a".repeat(64),
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "scrape-bundle",
          version: 4,
          contentHash: "b".repeat(64),
        },
      ]),
    ).toThrow(/duplicate selected skill slug/i);

    expect(() =>
      parseSelectedSkillReferences([
        {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "scrape-bundle",
          version: 0,
          contentHash: "not-a-hash",
        },
      ]),
    ).toThrow(/invalid selected skill reference/i);
  });

  it("fails closed when the API returns a different version before writing files", async () => {
    let requestedUrl = "";
    globalThis.fetch = Object.assign(
      mock(async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return makeSkillResponse({ version: 4 });
      }),
      { preconnect: originalFetch.preconnect },
    );
    const writeFileViaExec = mock(async () => {});
    const execInContainer = mock(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    await expect(
      resolveSkillFromDb(
        {
          workerClient: {} as never,
          containerManager: {
            execInContainer,
            writeFileViaExec,
          } as never,
          apiBaseUrl: "https://api.almirant.ai",
          apiKey: "runner-key",
        },
        {
          skillId: "11111111-1111-4111-8111-111111111111",
          skillSlug: "scrape-bundle",
          expectedVersion: 3,
          expectedContentHash: skillContentHash,
          projectId: "project-1",
          workspaceId: "org-1",
          containerId: "container-1",
          runtimeType: "codex-shim",
          eventLogger,
        },
      ),
    ).rejects.toThrow(/version mismatch/i);

    expect(requestedUrl).toContain("expectedVersion=3");
    expect(requestedUrl).toContain(
      `expectedContentHash=${skillContentHash}`,
    );
    expect(execInContainer).not.toHaveBeenCalled();
    expect(writeFileViaExec).not.toHaveBeenCalled();
  });

  it("fails closed when response bytes do not match the pinned content hash", async () => {
    globalThis.fetch = Object.assign(
      mock(async () =>
        makeSkillResponse({
          content: "# Tampered scrape bundle",
          contentHash: skillContentHash,
        }),
      ),
      { preconnect: originalFetch.preconnect },
    );
    const writeFileViaExec = mock(async () => {});
    const execInContainer = mock(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    await expect(
      resolveSkillFromDb(
        {
          workerClient: {} as never,
          containerManager: {
            execInContainer,
            writeFileViaExec,
          } as never,
          apiBaseUrl: "https://api.almirant.ai",
          apiKey: "runner-key",
        },
        {
          skillId: "11111111-1111-4111-8111-111111111111",
          skillSlug: "scrape-bundle",
          expectedVersion: 3,
          expectedContentHash: skillContentHash,
          projectId: "project-1",
          workspaceId: "org-1",
          containerId: "container-1",
          runtimeType: "codex-shim",
          eventLogger,
        },
      ),
    ).rejects.toThrow(/content bytes.*hash mismatch/i);

    expect(execInContainer).not.toHaveBeenCalled();
    expect(writeFileViaExec).not.toHaveBeenCalled();
  });

  it("uses the server canonical CRLF and trim normalization when verifying bytes", async () => {
    const canonicalEquivalentContent = " \r\n# Scrape bundle\r\n ";
    globalThis.fetch = Object.assign(
      mock(async () =>
        makeSkillResponse({
          content: canonicalEquivalentContent,
          contentHash: skillContentHash,
        }),
      ),
      { preconnect: originalFetch.preconnect },
    );
    const writes: string[] = [];

    await resolveSkillFromDb(
      {
        workerClient: {} as never,
        containerManager: {
          execInContainer: async () => ({
            exitCode: 0,
            stdout: "",
            stderr: "",
          }),
          writeFileViaExec: async (
            _containerId: string,
            _path: string,
            content: string,
          ) => {
            writes.push(content);
          },
        } as never,
        apiBaseUrl: "https://api.almirant.ai",
        apiKey: "runner-key",
      },
      {
        skillId: "11111111-1111-4111-8111-111111111111",
        skillSlug: "scrape-bundle",
        expectedVersion: 3,
        expectedContentHash: skillContentHash,
        containerId: "container-1",
        runtimeType: "claude-shim",
        eventLogger,
      },
    );

    expect(writes).toEqual([canonicalEquivalentContent]);
  });

  it("materializes auxiliary skills in both Codex and Claude-compatible paths", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => makeSkillResponse()),
      { preconnect: originalFetch.preconnect },
    );
    const writes: Array<[string, string]> = [];
    const execInContainer = mock(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const resolved = await materializeSelectedSkills(
      {
        workerClient: {} as never,
        containerManager: {
          execInContainer,
          writeFileViaExec: async (
            _containerId: string,
            path: string,
            content: string,
          ) => {
            writes.push([path, content]);
          },
        } as never,
        apiBaseUrl: "https://api.almirant.ai",
        apiKey: "runner-key",
      },
      {
        selectedSkills: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            slug: "scrape-bundle",
            version: 3,
            contentHash: skillContentHash,
          },
        ],
        projectId: "project-1",
        workspaceId: "org-1",
        containerId: "container-1",
        runtimeType: "codex-shim",
        eventLogger,
      },
    );

    expect(resolved.map((skill) => skill.slug)).toEqual(["scrape-bundle"]);
    expect(writes).toEqual([
      [
        "/workspace/repo/.agents/skills/scrape-bundle/SKILL.md",
        skillContent,
      ],
      [
        "/workspace/repo/.claude/skills/scrape-bundle/SKILL.md",
        skillContent,
      ],
    ]);
  });
});
