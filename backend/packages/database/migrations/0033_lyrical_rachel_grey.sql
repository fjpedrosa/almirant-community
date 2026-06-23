ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_file_path_project_idx" ON "documents" USING btree ("file_path","project_id");