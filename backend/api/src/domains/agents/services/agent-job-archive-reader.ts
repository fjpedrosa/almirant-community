import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { getAgentJobEventArchive } from "@almirant/database";
import { getArchiveBlob } from "../../../shared/services/archive-blob-store";
import { AGENT_JOB_ARCHIVE_KIND } from "./agent-job-archive-storage";

export type ArchivedNativeEvent = Record<string, unknown> & { sequenceNum: number };

export interface ArchivedNativeEventFilters {
  afterSequence?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 5000;

/**
 * Decodes only as far as `limit` requires: a purged job can hold hundreds of
 * thousands of events and must never be materialised to serve one page.
 */
export const readArchivedNativeEventsFromBlob = async (
  blob: Uint8Array,
  { afterSequence, limit = DEFAULT_LIMIT }: ArchivedNativeEventFilters,
): Promise<ArchivedNativeEvent[]> => {
  const input = Readable.from(Buffer.from(blob)).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const events: ArchivedNativeEvent[] = [];

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;

      let event: ArchivedNativeEvent;
      try {
        event = JSON.parse(line) as ArchivedNativeEvent;
      } catch {
        continue;
      }

      if (afterSequence !== undefined && event.sequenceNum <= afterSequence) continue;

      events.push(event);
      if (events.length >= limit) break;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  return events;
};

export const readArchivedNativeEvents = async (
  agentJobId: string,
  filters: ArchivedNativeEventFilters,
): Promise<ArchivedNativeEvent[] | null> => {
  const archive = await getAgentJobEventArchive(
    agentJobId,
    AGENT_JOB_ARCHIVE_KIND.nativeEvents,
  );
  if (!archive) return null;

  const blob = await getArchiveBlob({
    storageBucket: archive.storageBucket,
    storageKey: archive.storageKey,
    storageUrl: archive.storageUrl,
  });

  return readArchivedNativeEventsFromBlob(blob, filters);
};
