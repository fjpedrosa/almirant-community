import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { AgentNativeEventDb } from "@almirant/database";
import { putArchiveBlob } from "../../../shared/services/archive-blob-store";

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

export const uploadAgentJobNativeEventsArchive = async (
  agentJobId: string,
  events: AgentNativeEventDb[],
): Promise<UploadedAgentJobArchive> => {
  const ndjson = events
    .map((event) =>
      `${JSON.stringify({
        ...event,
        emittedAt: normaliseDate(event.emittedAt),
        receivedAt: normaliseDate(event.receivedAt),
        createdAt: normaliseDate(event.createdAt),
      })}\n`,
    )
    .join("");

  const body = new Uint8Array(gzipSync(Buffer.from(ndjson, "utf-8")));
  const stored = await putArchiveBlob(
    `agent-jobs/${agentJobId}/${AGENT_JOB_ARCHIVE_KIND.nativeEvents}.ndjson.gz`,
    body,
  );

  return {
    ...stored,
    format: "ndjson",
    compression: "gzip",
    contentType: "application/gzip",
    rowCount: events.length,
    lastSequenceNum: events.length > 0 ? events[events.length - 1]!.sequenceNum : null,
    checksumSha256: createHash("sha256").update(body).digest("hex"),
  };
};
