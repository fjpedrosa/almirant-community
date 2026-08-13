import type { AgentNativeEventDb } from "@almirant/database";
import { putArchiveBlobFromLines } from "../../../shared/services/archive-blob-store";

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

export const toNativeEventLine = (event: AgentNativeEventDb): string =>
  `${JSON.stringify({
    ...event,
    emittedAt: normaliseDate(event.emittedAt),
    receivedAt: normaliseDate(event.receivedAt),
    createdAt: normaliseDate(event.createdAt),
  })}\n`;

export const uploadAgentJobNativeEventsArchive = async (
  agentJobId: string,
  events: AsyncIterable<AgentNativeEventDb>,
): Promise<UploadedAgentJobArchive> => {
  let rowCount = 0;
  let lastSequenceNum: number | null = null;

  const lines = async function* () {
    for await (const event of events) {
      rowCount += 1;
      lastSequenceNum = event.sequenceNum;
      yield toNativeEventLine(event);
    }
  };

  const stored = await putArchiveBlobFromLines(
    `agent-jobs/${agentJobId}/${AGENT_JOB_ARCHIVE_KIND.nativeEvents}.ndjson.gz`,
    lines(),
  );

  return {
    storageBucket: stored.storageBucket,
    storageKey: stored.storageKey,
    storageUrl: stored.storageUrl,
    format: "ndjson",
    compression: "gzip",
    contentType: "application/gzip",
    rowCount,
    lastSequenceNum,
    checksumSha256: stored.checksumSha256,
  };
};
