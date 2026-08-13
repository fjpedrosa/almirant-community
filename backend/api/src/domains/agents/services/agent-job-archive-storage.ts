import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGzip } from "node:zlib";
import type { AgentNativeEventDb } from "@almirant/database";
import { putArchiveBlobFromFile } from "../../../shared/services/archive-blob-store";

export const AGENT_JOB_ARCHIVE_KIND = {
  nativeEvents: "native_events",
} as const;

export type UploadedAgentJobArchive = {
  storageBucket: string | null;
  storageKey: string;
  storageUrl: string | null;
  format: "ndjson";
  compression: "gzip";
  contentType: "application/gzip";
  rowCount: number;
  lastSequenceNum: number | null;
  checksumSha256: string;
};

const normaliseDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const toJsonLine = (event: AgentNativeEventDb): string =>
  `${JSON.stringify({
    ...event,
    emittedAt: normaliseDate(event.emittedAt),
    receivedAt: normaliseDate(event.receivedAt),
    createdAt: normaliseDate(event.createdAt),
  })}\n`;

export type AgentNativeEventPages = AsyncIterable<AgentNativeEventDb[]>;

export const uploadAgentJobNativeEventsArchivePages = async (
  agentJobId: string,
  pages: AgentNativeEventPages,
): Promise<UploadedAgentJobArchive | null> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "almirant-native-events-"));
  const tempPath = path.join(tempDir, "native_events.ndjson.gz");
  const gzip = createGzip();
  const output = createWriteStream(tempPath, { flags: "wx" });
  const outputDone = new Promise<void>((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
    gzip.once("error", reject);
  });
  gzip.pipe(output);

  let rowCount = 0;
  let lastSequenceNum: number | null = null;
  try {
    for await (const page of pages) {
      for (const event of page) {
        if (!gzip.write(toJsonLine(event))) await once(gzip, "drain");
        rowCount += 1;
        lastSequenceNum = event.sequenceNum;
      }
    }
    gzip.end();
    await outputDone;
    if (rowCount === 0) return null;

    const checksum = createHash("sha256");
    for await (const chunk of createReadStream(tempPath)) checksum.update(chunk);
    const stored = await putArchiveBlobFromFile(
      `agent-jobs/${agentJobId}/${AGENT_JOB_ARCHIVE_KIND.nativeEvents}.ndjson.gz`,
      tempPath,
      "application/gzip",
    );
    return {
      ...stored,
      format: "ndjson",
      compression: "gzip",
      contentType: "application/gzip",
      rowCount,
      lastSequenceNum,
      checksumSha256: checksum.digest("hex"),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const uploadAgentJobNativeEventsArchive = async (
  agentJobId: string,
  events: AgentNativeEventDb[],
): Promise<UploadedAgentJobArchive> => {
  const uploaded = await uploadAgentJobNativeEventsArchivePages(agentJobId, (async function* () {
    yield events;
  })());
  if (uploaded === null) throw new Error("Cannot archive an empty native-event history");
  return uploaded;
};
