import { env } from "@almirant/config";
import type { HandbookChunkCandidate } from "./handbook-importer";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MAX_TOKEN_CHARS = 8191 * 4;

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

const sanitizeInput = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= MAX_TOKEN_CHARS ? trimmed : trimmed.slice(0, MAX_TOKEN_CHARS);
};

export const generateHandbookEmbeddingsIfConfigured = async (
  inputs: string[],
): Promise<number[][] | null> => {
  if (!env.OPENAI_API_KEY || inputs.length === 0) return null;

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: inputs.map(sanitizeInput),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
  }

  const body = (await response.json()) as EmbeddingResponse;
  return [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
};

export const attachEmbeddingsToHandbookChunks = async (
  chunks: HandbookChunkCandidate[],
): Promise<Array<HandbookChunkCandidate & { embedding?: number[] | null }>> => {
  const embeddings = await generateHandbookEmbeddingsIfConfigured(chunks.map((chunk) => chunk.content));
  if (!embeddings) return chunks.map((chunk) => ({ ...chunk, embedding: null }));

  return chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index] ?? null,
  }));
};
