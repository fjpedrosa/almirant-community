import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, mock, test } from "bun:test";
import type { AgentNativeEventDb } from "@almirant/database";

let capturedPath: string | null = null;
let capturedBody: Buffer | null = null;
let failUpload = false;

mock.module("../../../shared/services/archive-blob-store", () => ({ putArchiveBlobFromFile: async (_key: string, filePath: string) => {
  capturedPath = filePath; capturedBody = readFileSync(filePath);
  if (failUpload) throw new Error("storage unavailable");
  return { storageBucket: null, storageKey: _key, storageUrl: null };
} }));

const { uploadAgentJobNativeEventsArchivePages } = await import("./agent-job-archive-storage");

const event = (sequenceNum: number) => ({ id: `event-${sequenceNum}`, agentJobId: "job-1", planningSessionId: null, sequenceNum, nativeEventType: "message", sourceFormat: "sse", provider: null, codingAgent: null, runtimeSessionId: null, payload: { text: "hello" }, emittedAt: null, receivedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") }) as AgentNativeEventDb;

describe("agent job native archive storage", () => {
  test("serializes pages without retaining the complete history", async () => {
    capturedPath = null;
    capturedBody = null;
    failUpload = false;
    const pages = (async function* () { yield [event(1), event(2)]; yield [event(3)]; })();

    const uploaded = await uploadAgentJobNativeEventsArchivePages("job-1", pages);
    expect(uploaded?.rowCount).toBe(3);
    expect(uploaded?.lastSequenceNum).toBe(3);
    expect(capturedPath).not.toBeNull();
    const uploadedBody = capturedBody as unknown as Buffer;
    const ndjson = gunzipSync(uploadedBody).toString("utf8");
    const expected = [event(1), event(2), event(3)].map((value) => `${JSON.stringify({ ...value, emittedAt: null, receivedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" })}\n`).join("");
    expect(ndjson).toBe(expected);
    expect(uploadedBody).toEqual(gzipSync(Buffer.from(expected)));
    expect(uploaded?.checksumSha256).toBe(createHash("sha256").update(uploadedBody).digest("hex"));
  });

  test("cleans the spool when durable upload fails", async () => {
    capturedPath = null;
    capturedBody = null;
    failUpload = true;
    const pages = (async function* () { yield [event(1)]; })();

    await expect(uploadAgentJobNativeEventsArchivePages("job-1", pages)).rejects.toThrow(
      "storage unavailable",
    );
    expect(capturedPath).not.toBeNull();
    expect(existsSync(capturedPath!)).toBe(false);
    failUpload = false;
  });
});
