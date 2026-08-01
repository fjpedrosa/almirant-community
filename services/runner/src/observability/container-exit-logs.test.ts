import { describe, expect, it, mock } from "bun:test";
import { Readable } from "node:stream";

import { captureContainerExitLogs } from "./container-exit-logs";

const streamOf = (chunks: string[]): NodeJS.ReadableStream =>
  Readable.from(chunks.map((chunk) => Buffer.from(chunk, "utf8")));

describe("captureContainerExitLogs", () => {
  it("returns the container output split into lines", async () => {
    const readLogs = mock(async () => streamOf(["[entrypoint] Cloning...\nfatal: could not read\n"]));

    const result = await captureContainerExitLogs(readLogs, "container-1");

    expect(result?.lines).toEqual(["[entrypoint] Cloning...", "fatal: could not read"]);
    expect(result?.truncated).toBe(false);
    expect(readLogs).toHaveBeenCalledWith("container-1");
  });

  it("keeps the LAST lines, because the failure is at the end of the log", async () => {
    const readLogs = mock(async () =>
      streamOf([Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n")]),
    );

    const result = await captureContainerExitLogs(readLogs, "container-1", { maxLines: 3 });

    expect(result?.lines).toEqual(["line 7", "line 8", "line 9"]);
    expect(result?.truncated).toBe(true);
  });

  it("redacts secrets that the entrypoint may have echoed", async () => {
    const readLogs = mock(async () =>
      streamOf(["__GIT_CLONE_TOKEN=ghs_supersecretvalue cloning\n"]),
    );

    const result = await captureContainerExitLogs(readLogs, "container-1");

    expect(result?.lines.join("\n")).not.toContain("ghs_supersecretvalue");
  });

  it("strips the 8-byte frame Docker prepends on non-tty streams", async () => {
    // stdout frame: stream type 1, three zero bytes, then a big-endian length.
    const framed = "\x01\x00\x00\x00\x00\x00\x00\x12[entrypoint] ERROR\n";
    const readLogs = mock(async () => streamOf([framed]));

    const result = await captureContainerExitLogs(readLogs, "container-1");

    expect(result?.lines).toEqual(["[entrypoint] ERROR"]);
  });

  it("stops reading once the byte budget is spent", async () => {
    const readLogs = mock(async () => streamOf(["a".repeat(50), "\n", "b".repeat(50)]));

    const result = await captureContainerExitLogs(readLogs, "container-1", { maxBytes: 60 });

    expect(result?.truncated).toBe(true);
    expect(result!.lines.join("").length).toBeLessThanOrEqual(60);
  });

  it("returns null instead of throwing when the log stream is unavailable", async () => {
    const readLogs = mock(async () => {
      throw new Error("no such container");
    });

    expect(await captureContainerExitLogs(readLogs, "gone")).toBeNull();
  });

  it("returns null when the container produced no output", async () => {
    const readLogs = mock(async () => streamOf([]));

    expect(await captureContainerExitLogs(readLogs, "quiet")).toBeNull();
  });

  it("gives up on a stream that never ends", async () => {
    const readLogs = mock(
      async () =>
        new Readable({
          read() {
            this.push("still going\n");
          },
        }) as unknown as NodeJS.ReadableStream,
    );

    const result = await captureContainerExitLogs(readLogs, "container-1", {
      timeoutMs: 50,
      maxBytes: 10_000_000,
    });

    // The tail is cut mid-write, so only assert what matters: the read ended,
    // it reported the loss, and the captured lines are readable.
    expect(result?.truncated).toBe(true);
    expect(result?.lines[0]).toBe("still going");
  });
});
