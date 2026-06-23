CREATE TABLE "sprint_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_attachments" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "sprint_documents" ADD CONSTRAINT "sprint_documents_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_documents" ADD CONSTRAINT "sprint_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_documents_sprint_kind_unique_idx" ON "sprint_documents" USING btree ("sprint_id","kind");--> statement-breakpoint
CREATE INDEX "sprint_documents_document_id_idx" ON "sprint_documents" USING btree ("document_id");