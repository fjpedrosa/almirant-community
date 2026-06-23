ALTER TABLE "feedback_items" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "requires_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_items_embedding_idx" ON "feedback_items" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_clusters_embedding_idx" ON "feedback_clusters" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);