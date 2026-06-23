import type { TranscriptSegment } from "../../domain/types";

export interface SessionTranscriptChunk {
  seq: number;
  message: string;
  timestamp?: string;
  contentType?: "thinking" | "text" | "tool_use";
}

export const mergeTranscriptChunks = (
  initialChunks: SessionTranscriptChunk[],
  wsChunks: SessionTranscriptChunk[],
): SessionTranscriptChunk[] => {
  const merged = new Map<number, SessionTranscriptChunk>();

  for (const chunk of initialChunks) {
    merged.set(chunk.seq, chunk);
  }

  for (const chunk of wsChunks) {
    const existing = merged.get(chunk.seq);
    merged.set(chunk.seq, {
      ...existing,
      ...chunk,
      contentType: chunk.contentType ?? existing?.contentType,
    });
  }

  return [...merged.values()].sort((a, b) => a.seq - b.seq);
};

export const serializeTranscriptChunks = (
  chunks: SessionTranscriptChunk[],
  fallbackTranscript: string,
): string => {
  if (chunks.length === 0) return fallbackTranscript;
  return chunks.map((chunk) => chunk.message).join("\n");
};

export const buildTranscriptSegments = (
  chunks: SessionTranscriptChunk[],
  fallbackTranscript: string,
): TranscriptSegment[] => {
  if (chunks.length === 0) {
    return fallbackTranscript
      ? [{ contentType: "text", content: fallbackTranscript }]
      : [];
  }

  const result: TranscriptSegment[] = [];

  for (const chunk of chunks) {
    const type = chunk.contentType ?? "text";
    const last = result[result.length - 1];

    if (last && last.contentType === type) {
      last.content += "\n" + chunk.message;
      continue;
    }

    result.push({ contentType: type, content: chunk.message });
  }

  return result;
};
