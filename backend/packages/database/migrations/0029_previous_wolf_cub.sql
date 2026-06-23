ALTER TABLE "documents" ADD COLUMN "content_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "s3_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_path" text;--> statement-breakpoint
CREATE INDEX "documents_content_hash_idx" ON "documents" USING btree ("content_hash");