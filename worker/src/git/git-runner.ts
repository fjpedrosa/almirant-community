type RunGitOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
};

const readStream = async (stream: ReadableStream | null): Promise<string> => {
  if (!stream) return "";
  return await new Response(stream).text();
};

export const runGit = async (args: string[], opts: RunGitOptions): Promise<{ stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const err = stderr.trim() || stdout.trim();
    throw new Error(`git ${args.join(" ")} failed (exit ${exitCode})${err ? `\n${err}` : ""}`);
  }

  return { stdout, stderr };
};

