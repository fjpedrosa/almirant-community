import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { askDocuments } from "./ask-documents";

// Custom type for pgvector vector(1536) — for future embedding-based retrieval
const vector1536 = customType<{ data: number[] }>({
  dataType() {
    return "vector(1536)";
  },
});

/**
 * Chunks for embedding/retrieval within the Ask feature.
 * Each ask_document may be split into multiple chunks for more granular
 * vector search and context window management.
 */
export const askChunks = pgTable(
  "ask_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    askDocumentId: uuid("ask_document_id")
      .notNull()
      .references(() => askDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector1536("embedding"),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ask_chunks_document_idx").on(table.askDocumentId),
    index("ask_chunks_document_chunk_idx").on(
      table.askDocumentId,
      table.chunkIndex
    ),
  ]
);

// Type exports
export type AskChunk = typeof askChunks.$inferSelect;
export type NewAskChunk = typeof askChunks.$inferInsert;
