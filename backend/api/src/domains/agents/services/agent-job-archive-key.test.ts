import { describe, expect, test } from "bun:test";
import { buildNativeEventsArchiveKey } from "./agent-job-archive-key";

describe("archive key", () => {
  test("namespaces by workspace so each tenant owns its own prefix", () => {
    expect(buildNativeEventsArchiveKey("job-1", "ws-1")).toBe(
      "workspaces/ws-1/agent-jobs/job-1/native_events.ndjson.gz",
    );
  });

  test("keeps the flat prefix when there is no workspace", () => {
    expect(buildNativeEventsArchiveKey("job-1", null)).toBe(
      "agent-jobs/job-1/native_events.ndjson.gz",
    );
  });

  test("never lets an identifier escape its prefix", () => {
    expect(() => buildNativeEventsArchiveKey("../../etc/passwd", null)).toThrow(
      /Invalid archive identifier/,
    );
    expect(() => buildNativeEventsArchiveKey("job-1", "../other")).toThrow(
      /Invalid archive identifier/,
    );
  });
});
