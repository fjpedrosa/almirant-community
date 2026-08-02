import { describe, expect, it, mock } from "bun:test";
import { pushChanges } from "./runner-push";
import { createExecutionBoundary } from "@almirant/shared";

describe("runner push execution deadline", () => {
  it("stops before git push when an earlier command crosses the live cutoff", async () => {
    let current = new Date("2026-07-20T12:00:00.000Z");
    const commands: string[] = [];
    const runCommand = mock(async (command: string, args: string[]) => {
      commands.push([command, ...args].join(" "));
      current = new Date("2026-07-20T12:00:00.001Z");
      return { stdout: "", stderr: "" };
    });

    await expect(
      pushChanges(
        {
          collected: {
            modifiedFiles: ["src/app.ts"],
            fullDiff: "",
            archiveBuffer: Buffer.alloc(0),
            archiveMode: "selective",
            archivePaths: [],
            tmpDir: "/tmp/not-used",
          },
          repoUrl: "/tmp/missing-origin.git",
          branch: "almirant/job-deadline",
          gitToken: "unused",
          jobId: "job-deadline",
          gitIdentity: {
            name: "Almirant",
            email: "runner@almirant.ai",
          },
          executionBoundary: createExecutionBoundary({
            deadlineAt: new Date("2026-07-20T12:00:00.001Z"),
            now: () => current,
          }),
        },
        { runCommand },
      ),
    ).rejects.toThrow("execution_boundary_deadline_exceeded");

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("git clone");
    expect(commands.some((command) => command.includes("git push"))).toBe(false);
  });

  it("does not start git push when commit completion reaches the exact cutoff", async () => {
    let current = new Date("2026-07-20T12:00:00.000Z");
    const commands: string[] = [];
    const runCommand = mock(async (command: string, args: string[]) => {
      const rendered = [command, ...args].join(" ");
      commands.push(rendered);
      if (rendered.includes(" status ")) {
        return { stdout: "M  src/app.ts\n", stderr: "" };
      }
      if (rendered.includes(" commit ")) {
        current = new Date("2026-07-20T12:00:00.001Z");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      pushChanges(
        {
          collected: {
            modifiedFiles: ["src/app.ts"],
            fullDiff: "",
            archiveBuffer: Buffer.alloc(0),
            archiveMode: "selective",
            archivePaths: [],
            tmpDir: "/tmp/not-used",
          },
          repoUrl: "/tmp/fake-origin.git",
          branch: "almirant/job-commit-cutoff",
          gitToken: "unused",
          jobId: "job-commit-cutoff",
          gitIdentity: {
            name: "Almirant",
            email: "runner@almirant.ai",
          },
          executionBoundary: createExecutionBoundary({
            deadlineAt: new Date("2026-07-20T12:00:00.001Z"),
            now: () => current,
          }),
        },
        { runCommand },
      ),
    ).rejects.toThrow("execution_boundary_deadline_exceeded");

    expect(commands.some((command) => command.includes(" commit "))).toBe(true);
    expect(commands.some((command) => command.includes("git push"))).toBe(false);
  });

  it("aborts an in-flight git push with a freshly clamped command signal", async () => {
    const cutoffBudgetMs = 100;
    const executionBoundary = createExecutionBoundary({
      deadlineAt: new Date(Date.now() + cutoffBudgetMs),
    });
    let pushSignal: AbortSignal | undefined;
    const runCommand = mock(
      async (
        command: string,
        args: string[],
        options: { signal: AbortSignal },
      ) => {
        const rendered = [command, ...args].join(" ");
        if (rendered.includes(" status ")) {
          return { stdout: "M  src/app.ts\n", stderr: "" };
        }
        if (rendered.includes("git rev-parse HEAD")) {
          return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
        }
        if (rendered.includes("git push")) {
          pushSignal = options.signal;
          await new Promise<void>((_resolve, reject) => {
            if (options.signal.aborted) {
              reject(options.signal.reason);
              return;
            }
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
          });
        }
        return { stdout: "", stderr: "" };
      },
    );

    await expect(
      pushChanges(
        {
          collected: {
            modifiedFiles: ["src/app.ts"],
            fullDiff: "",
            archiveBuffer: Buffer.alloc(0),
            archiveMode: "selective",
            archivePaths: [],
            tmpDir: "/tmp/not-used",
          },
          repoUrl: "/tmp/fake-origin.git",
          branch: "almirant/job-push-abort",
          gitToken: "unused",
          jobId: "job-push-abort",
          gitIdentity: {
            name: "Almirant",
            email: "runner@almirant.ai",
          },
          executionBoundary,
        },
        { runCommand },
      ),
    ).rejects.toThrow("execution_boundary_deadline_exceeded");

    expect(pushSignal).toBeInstanceOf(AbortSignal);
    expect(pushSignal?.aborted).toBe(true);
  });
});
