/**
 * Capture what a container printed before it died.
 *
 * When the entrypoint fails — a clone without credentials, a missing env var —
 * it explains itself on stdout and exits non-zero. Nothing read that output, so
 * the job surfaced only the downstream symptom ("serve never became ready") and
 * the actual cause was gone with the container. This module reads the tail of
 * the log so the failure can be named in the job's own event log.
 */

import { sanitizeLogContent } from "./log-sanitizer";

export type ContainerExitLogs = {
  /** Sanitized tail of the container output, oldest line first. */
  lines: string[];
  /** True when output was dropped, either by the line or the byte budget. */
  truncated: boolean;
};

export type CaptureContainerExitLogsOptions = {
  /** How many trailing lines to keep. The failure is always at the end. */
  maxLines?: number;
  /** Hard cap on bytes read, so a chatty container cannot flood the job log. */
  maxBytes?: number;
  /** Abort the read when the stream refuses to end (follow:true on a live container). */
  timeoutMs?: number;
};

const DEFAULT_MAX_LINES = 40;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Docker frames non-tty streams with an 8-byte header per chunk. Rather than
 * demultiplexing (agent containers run with a tty, so framing is the exception),
 * drop control bytes and trim — a header degrades into leading whitespace.
 */
const CONTROL_BYTES = /[\x00-\x08\x0B-\x1F\x7F]/g;

const cleanLine = (line: string): string => line.replace(CONTROL_BYTES, "").trim();

const readStreamTail = async (
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ text: string; truncated: boolean }> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  const destroy = () => {
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  };

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      truncated = true;
      destroy();
      finish();
    }, timeoutMs);

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - bytes;
      if (buffer.length >= remaining) {
        chunks.push(buffer.subarray(0, Math.max(0, remaining)));
        truncated = true;
        destroy();
        finish();
        return;
      }
      bytes += buffer.length;
      chunks.push(buffer);
    });
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });

  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
};

/**
 * Read the tail of a container's log. Returns null when there is nothing to
 * report — an unreadable stream or a silent container is not worth an event,
 * and diagnostics must never be the reason a teardown fails.
 */
export const captureContainerExitLogs = async (
  readLogs: (containerId: string) => Promise<NodeJS.ReadableStream>,
  containerId: string,
  options?: CaptureContainerExitLogsOptions,
): Promise<ContainerExitLogs | null> => {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: { text: string; truncated: boolean };
  try {
    const stream = await readLogs(containerId);
    raw = await readStreamTail(stream, maxBytes, timeoutMs);
  } catch {
    return null;
  }

  const all = sanitizeLogContent(raw.text)
    .split("\n")
    .map(cleanLine)
    .filter((line) => line.length > 0);

  if (all.length === 0) return null;

  return {
    lines: all.slice(-maxLines),
    truncated: raw.truncated || all.length > maxLines,
  };
};
