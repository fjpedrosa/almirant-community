import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pushChanges } from "../src/delivery/runner-push";
import type { CollectedChanges } from "../src/delivery/change-collector";

const execFileAsync = promisify(execFile);

const run = async (cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync(cmd, args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 50 * 1024 * 1024,
  });
};

const writeRepoFile = async (repoDir: string, relativePath: string, content: string): Promise<void> => {
  const target = join(repoDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
};

const createSelectiveArchive = async (sourceRepo: string, paths: string[], tempDir: string): Promise<Buffer> => {
  const archiveRoot = join(tempDir, "archive-root");
  const archiveRepo = join(archiveRoot, "repo");
  await mkdir(archiveRepo, { recursive: true });

  for (const relativePath of paths) {
    const source = join(sourceRepo, relativePath);
    const target = join(archiveRepo, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(source));
  }

  const tarPath = join(tempDir, "selective.tar");
  await run("tar", ["cf", tarPath, "-C", archiveRoot, "repo"]);
  return Buffer.from(await readFile(tarPath));
};

describe("pushChanges selective collection mode", () => {
  it("applies tracked binary patch and extracts only the selective untracked archive", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "almirant-push-selective-test-"));

    try {
      const originDir = join(tempDir, "origin.git");
      const workDir = join(tempDir, "work");
      const verifyDir = join(tempDir, "verify");

      await run("git", ["init", "--bare", "-b", "main", originDir]);
      await run("git", ["clone", originDir, workDir]);
      await run("git", ["config", "user.name", "Test User"], workDir);
      await run("git", ["config", "user.email", "test@example.com"], workDir);

      await writeRepoFile(workDir, "src/app.txt", "before\n");
      await run("git", ["add", "src/app.txt"], workDir);
      await run("git", ["commit", "-m", "initial"], workDir);
      await run("git", ["push", "origin", "main"], workDir);

      await writeRepoFile(workDir, "src/app.txt", "after\n");
      await writeRepoFile(workDir, "docs/new.md", "new file\n");
      const { stdout: fullDiff } = await run("git", ["diff", "--binary", "HEAD"], workDir);
      const archiveBuffer = await createSelectiveArchive(workDir, ["docs/new.md"], tempDir);

      const collected: CollectedChanges = {
        modifiedFiles: ["src/app.txt", "docs/new.md"],
        fullDiff,
        archiveBuffer,
        archiveMode: "selective",
        archivePaths: ["docs/new.md"],
        tmpDir: tempDir,
      };

      const result = await pushChanges({
        collected,
        repoUrl: originDir,
        branch: "main",
        gitToken: "unused-for-local-repo",
        jobId: "job-selective-test",
      });

      expect(result).toEqual({ success: true, modifiedFileCount: 2 });

      await run("git", ["clone", originDir, verifyDir]);
      expect(await readFile(join(verifyDir, "src/app.txt"), "utf8")).toBe("after\n");
      expect(await readFile(join(verifyDir, "docs/new.md"), "utf8")).toBe("new file\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
