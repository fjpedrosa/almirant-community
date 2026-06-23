import type { JobLogLine, SpawnResult } from "./types";

export interface SpawnOpts {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onLog?: (line: JobLogLine) => void;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const nowIso = (): string => new Date().toISOString();

const consumeStream = async (
  stream: ReadableStream<Uint8Array> | undefined | null,
  source: "stdout" | "stderr",
  onLog: ((line: JobLogLine) => void) | undefined,
): Promise<string> => {
  if (!(stream instanceof ReadableStream)) return "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    buf += chunk;
    let idx = buf.indexOf("\n");
    while (idx !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (onLog) onLog({ timestamp: nowIso(), source, text: line });
      idx = buf.indexOf("\n");
    }
  }
  if (buf.length > 0 && onLog) {
    onLog({ timestamp: nowIso(), source, text: buf });
  }
  return full;
};

/**
 * Spawn a command with stdout/stderr streamed line-by-line to onLog. The
 * returned strings contain the full captured output so callers can pattern
 * match on results without having to re-aggregate from the line callbacks.
 */
export const spawnCmd = async (
  argv: string[],
  opts: SpawnOpts,
): Promise<SpawnResult> => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timedOut = false;

  try {
    proc = Bun.spawn(argv, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc?.kill();
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
      consumeStream(proc.stdout as ReadableStream<Uint8Array> | null, "stdout", opts.onLog),
      consumeStream(proc.stderr as ReadableStream<Uint8Array> | null, "stderr", opts.onLog),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (timedOut) {
      return {
        ok: false,
        exitCode: exitCode ?? 124,
        stdout,
        stderr: stderr + `\n[timed out after ${timeoutMs}ms]`,
      };
    }

    return {
      ok: exitCode === 0,
      exitCode: exitCode ?? -1,
      stdout,
      stderr,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: -1, stdout: "", stderr: msg };
  }
};
