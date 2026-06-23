import { afterEach, describe, expect, it } from "bun:test";
import {
  cleanupCollectedChanges,
  collectChanges,
  type CollectedChanges,
} from "../src/delivery/change-collector";
import type { ContainerManager } from "../src/workspace/container-manager";

type ExecCall = { containerId: string; cmd: string[]; workingDir?: string };
type WriteBufferCall = { containerId: string; filePath: string; content: Buffer; mode?: string };

type MockContainerManager = ContainerManager & {
  execCalls: ExecCall[];
  writeBufferCalls: WriteBufferCall[];
  archivePaths: string[];
};

const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "failed") => ({ exitCode: 128, stdout: "", stderr });

const createMockContainerManager = (options: {
  onExec: (cmd: string[], workingDir?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }> | { exitCode: number; stdout: string; stderr: string };
  archiveBuffer?: Buffer;
}): MockContainerManager => {
  const execCalls: ExecCall[] = [];
  const writeBufferCalls: WriteBufferCall[] = [];
  const archivePaths: string[] = [];

  return {
    execCalls,
    writeBufferCalls,
    archivePaths,
    execInContainer: async (containerId: string, cmd: string[], workingDir?: string) => {
      execCalls.push({ containerId, cmd, workingDir });
      return options.onExec(cmd, workingDir);
    },
    writeFileBufferViaExec: async (containerId: string, filePath: string, content: Buffer, mode?: string) => {
      writeBufferCalls.push({ containerId, filePath, content, mode });
    },
    extractWorkspaceArchive: async (_containerId: string, path: string) => {
      archivePaths.push(path);
      return options.archiveBuffer ?? Buffer.from("archive");
    },
  } as unknown as MockContainerManager;
};

const collectedToCleanup: CollectedChanges[] = [];

afterEach(async () => {
  while (collectedToCleanup.length > 0) {
    const collected = collectedToCleanup.pop();
    if (collected) await cleanupCollectedChanges(collected);
  }
});

describe("collectChanges", () => {
  it("uses selective mode without creating an archive when there are only tracked changes", async () => {
    const manager = createMockContainerManager({
      onExec: (cmd) => {
        if (cmd.join(" ") === "git diff --name-only -z HEAD") return ok("src/app.ts\0");
        if (cmd.join(" ") === "git diff --binary HEAD") return ok("diff --git a/src/app.ts b/src/app.ts\n");
        if (cmd.join(" ") === "git ls-files --others --exclude-standard -z") return ok("");
        if (cmd[0] === "rm") return ok("");
        throw new Error(`unexpected exec: ${cmd.join(" ")}`);
      },
    });

    const collected = await collectChanges(manager, "container-1", "/workspace/repo");
    collectedToCleanup.push(collected);

    expect(collected.archiveMode).toBe("selective");
    expect(collected.archiveBuffer.length).toBe(0);
    expect(collected.archivePaths).toEqual([]);
    expect(collected.modifiedFiles).toEqual(["src/app.ts"]);
    expect(collected.fullDiff).toContain("diff --git");
    expect(manager.archivePaths).toEqual([]);
    expect(manager.writeBufferCalls).toEqual([]);
  });

  it("archives only safe untracked files in selective mode", async () => {
    const manager = createMockContainerManager({
      archiveBuffer: Buffer.from("selective-tar"),
      onExec: (cmd) => {
        if (cmd.join(" ") === "git diff --name-only -z HEAD") return ok("src/app.ts\0");
        if (cmd.join(" ") === "git diff --binary HEAD") return ok("diff --git a/src/app.ts b/src/app.ts\n");
        if (cmd.join(" ") === "git ls-files --others --exclude-standard -z") {
          return ok("new file.txt\0dir/new.ts\0../escape.txt\0.git/config\0nested/.git/config\0");
        }
        if (cmd[0] === "sh" || cmd[0] === "rm") return ok("");
        throw new Error(`unexpected exec: ${cmd.join(" ")}`);
      },
    });

    const collected = await collectChanges(manager, "container-1", "/workspace/repo", 5_000);
    collectedToCleanup.push(collected);

    expect(collected.archiveMode).toBe("selective");
    expect(collected.archiveBuffer.toString()).toBe("selective-tar");
    expect(collected.modifiedFiles).toEqual(["src/app.ts", "new file.txt", "dir/new.ts"]);
    expect(collected.archivePaths).toEqual(["new file.txt", "dir/new.ts"]);
    expect(manager.archivePaths).toHaveLength(1);
    expect(manager.archivePaths[0]).toMatch(/^\/tmp\/almirant-changes-.+\/repo$/);
    expect(manager.writeBufferCalls).toHaveLength(1);
    expect(manager.writeBufferCalls[0]?.content.toString("utf8")).toBe("new file.txt\0dir/new.ts\0");
    expect(manager.writeBufferCalls[0]?.mode).toBe("0600");
  });

  it("falls back to a full workspace archive when git metadata collection fails", async () => {
    const manager = createMockContainerManager({
      archiveBuffer: Buffer.from("full-archive"),
      onExec: (cmd) => {
        if (cmd.join(" ") === "git diff --name-only -z HEAD") return fail("not a git repo");
        if (cmd[0] === "rm") return ok("");
        throw new Error(`unexpected exec: ${cmd.join(" ")}`);
      },
    });

    const collected = await collectChanges(manager, "container-1", "/workspace/repo", 5_000);
    collectedToCleanup.push(collected);

    expect(collected.archiveMode).toBe("full");
    expect(collected.archiveBuffer.toString()).toBe("full-archive");
    expect(collected.archivePaths).toEqual(["/workspace/repo"]);
    expect(collected.modifiedFiles).toEqual([]);
    expect(manager.archivePaths).toEqual(["/workspace/repo"]);
  });
});
