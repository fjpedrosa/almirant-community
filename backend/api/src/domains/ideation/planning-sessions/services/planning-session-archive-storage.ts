import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  AgentNativeEventDb,
  SessionEventDb,
} from "@almirant/database";
import { env } from "@almirant/config";
import {
  downloadBufferFromS3,
  isS3Configured,
  uploadBufferToS3,
} from "../../../../shared/services/s3-service";

export const PLANNING_SESSION_ARCHIVE_KIND = {
  canonicalEvents: "canonical_events",
  nativeEvents: "native_events",
  sessionSnapshot: "session_snapshot",
} as const;

export type PlanningSessionArchiveKind =
  typeof PLANNING_SESSION_ARCHIVE_KIND[keyof typeof PLANNING_SESSION_ARCHIVE_KIND];

export type ArchivedSessionSnapshotPayload = {
  planningSessionId: string;
  projectorVersion: number;
  lastCanonicalSeq: number;
  timeline: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  archivedAt: string;
};

export type UploadedPlanningSessionArchive = {
  storageBucket: string | null;
  storageKey: string;
  storageUrl: string | null;
  format: "json" | "ndjson";
  compression: "gzip";
  contentType: "application/gzip";
  rowCount: number;
  lastSequenceNum: number | null;
  projectorVersion: number | null;
  checksumSha256: string;
};

type UploadArchiveBufferArgs = {
  planningSessionId: string;
  archiveKind: PlanningSessionArchiveKind;
  format: "json" | "ndjson";
  body: Uint8Array;
  rowCount: number;
  lastSequenceNum?: number | null;
  projectorVersion?: number | null;
};

const getArchiveBucket = (): string | null =>
  env.S3_PRIVATE_BUCKET ?? env.S3_BUCKET ?? null;

export const isPlanningSessionArchiveConfigured = (): boolean => {
  const bucket = getArchiveBucket();
  return !!bucket && isS3Configured(bucket);
};

const ensureArchiveStorageConfigured = (): string => {
  const bucket = getArchiveBucket();
  if (!bucket || !isS3Configured(bucket)) {
    throw new Error("Planning session archive storage is not configured");
  }
  return bucket;
};

const buildArchiveKey = (
  planningSessionId: string,
  archiveKind: PlanningSessionArchiveKind,
  format: "json" | "ndjson",
): string =>
  `planning-sessions/${planningSessionId}/${archiveKind}.${format}.gz`;

const computeChecksumSha256 = (buffer: Uint8Array): string =>
  createHash("sha256").update(buffer).digest("hex");

const gzipUtf8 = (content: string): Uint8Array =>
  new Uint8Array(gzipSync(Buffer.from(content, "utf-8")));

const normaliseDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const toJsonLine = (value: Record<string, unknown>): string =>
  `${JSON.stringify(value)}\n`;

const uploadPlanningSessionArchiveBuffer = async ({
  planningSessionId,
  archiveKind,
  format,
  body,
  rowCount,
  lastSequenceNum = null,
  projectorVersion = null,
}: UploadArchiveBufferArgs): Promise<UploadedPlanningSessionArchive> => {
  const bucket = ensureArchiveStorageConfigured();
  const storageKey = buildArchiveKey(planningSessionId, archiveKind, format);
  const storageUrl = await uploadBufferToS3(body, storageKey, "application/gzip", bucket);

  return {
    storageBucket: bucket,
    storageKey,
    storageUrl,
    format,
    compression: "gzip",
    contentType: "application/gzip",
    rowCount,
    lastSequenceNum,
    projectorVersion,
    checksumSha256: computeChecksumSha256(body),
  };
};

export const uploadCanonicalEventsArchive = async (
  planningSessionId: string,
  events: SessionEventDb[],
): Promise<UploadedPlanningSessionArchive> => {
  const ndjson = events
    .map((event) =>
      toJsonLine({
        ...event,
        createdAt: normaliseDate(event.createdAt),
      }),
    )
    .join("");

  const lastSequenceNum = events.length > 0 ? events[events.length - 1]!.sequenceNum : null;

  return uploadPlanningSessionArchiveBuffer({
    planningSessionId,
    archiveKind: PLANNING_SESSION_ARCHIVE_KIND.canonicalEvents,
    format: "ndjson",
    body: gzipUtf8(ndjson),
    rowCount: events.length,
    lastSequenceNum,
  });
};

export const uploadNativeEventsArchive = async (
  planningSessionId: string,
  events: AgentNativeEventDb[],
): Promise<UploadedPlanningSessionArchive> => {
  const ndjson = events
    .map((event) =>
      toJsonLine({
        ...event,
        emittedAt: normaliseDate(event.emittedAt),
        receivedAt: normaliseDate(event.receivedAt),
        createdAt: normaliseDate(event.createdAt),
      }),
    )
    .join("");

  const lastSequenceNum = events.length > 0 ? events[events.length - 1]!.sequenceNum : null;

  return uploadPlanningSessionArchiveBuffer({
    planningSessionId,
    archiveKind: PLANNING_SESSION_ARCHIVE_KIND.nativeEvents,
    format: "ndjson",
    body: gzipUtf8(ndjson),
    rowCount: events.length,
    lastSequenceNum,
  });
};

export const uploadSessionSnapshotArchive = async (
  snapshot: ArchivedSessionSnapshotPayload,
): Promise<UploadedPlanningSessionArchive> => {
  const body = gzipUtf8(JSON.stringify(snapshot));

  return uploadPlanningSessionArchiveBuffer({
    planningSessionId: snapshot.planningSessionId,
    archiveKind: PLANNING_SESSION_ARCHIVE_KIND.sessionSnapshot,
    format: "json",
    body,
    rowCount: 1,
    lastSequenceNum: snapshot.lastCanonicalSeq,
    projectorVersion: snapshot.projectorVersion,
  });
};

export const downloadArchivedSessionSnapshot = async (args: {
  storageKey: string;
  storageBucket?: string | null;
}): Promise<ArchivedSessionSnapshotPayload> => {
  const bucket = args.storageBucket ?? getArchiveBucket() ?? undefined;
  const compressed = await downloadBufferFromS3(args.storageKey, bucket);
  const decompressed = gunzipSync(Buffer.from(compressed));
  const parsed = JSON.parse(decompressed.toString("utf-8")) as ArchivedSessionSnapshotPayload;

  return parsed;
};
