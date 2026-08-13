import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { readArchivedNativeEventsFromBlob } from "./agent-job-archive-reader";

const archiveOf = (count: number): Uint8Array => {
  const lines = Array.from(
    { length: count },
    (_unused, index) =>
      `${JSON.stringify({
        id: `event-${index + 1}`,
        sequenceNum: index + 1,
        nativeEventType: "message",
        payload: { text: "hello" },
      })}\n`,
  ).join("");

  return new Uint8Array(gzipSync(Buffer.from(lines, "utf-8")));
};

describe("archived native event reader", () => {
  test("returns the events in sequence order", async () => {
    const events = await readArchivedNativeEventsFromBlob(archiveOf(3), {});

    expect(events.map((event) => event.sequenceNum)).toEqual([1, 2, 3]);
  });

  test("resumes after a sequence number", async () => {
    const events = await readArchivedNativeEventsFromBlob(archiveOf(5), { afterSequence: 3 });

    expect(events.map((event) => event.sequenceNum)).toEqual([4, 5]);
  });

  test("stops at the limit instead of decoding the whole archive", async () => {
    const events = await readArchivedNativeEventsFromBlob(archiveOf(50_000), { limit: 10 });

    expect(events).toHaveLength(10);
    expect(events[0]!.sequenceNum).toBe(1);
    expect(events[9]!.sequenceNum).toBe(10);
  });

  test("applies the limit after the resume point", async () => {
    const events = await readArchivedNativeEventsFromBlob(archiveOf(1_000), {
      afterSequence: 100,
      limit: 5,
    });

    expect(events.map((event) => event.sequenceNum)).toEqual([101, 102, 103, 104, 105]);
  });

  test("ignores a trailing partial line rather than throwing", async () => {
    const truncated = new Uint8Array(
      gzipSync(Buffer.from('{"sequenceNum":1}\n{"sequenceNum":2', "utf-8")),
    );

    const events = await readArchivedNativeEventsFromBlob(truncated, {});

    expect(events.map((event) => event.sequenceNum)).toEqual([1]);
  });
});
