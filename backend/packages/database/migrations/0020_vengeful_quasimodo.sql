CREATE TABLE "document_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_work_items" ADD CONSTRAINT "document_work_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_work_items" ADD CONSTRAINT "document_work_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_work_items_unique_idx" ON "document_work_items" USING btree ("document_id","work_item_id");--> statement-breakpoint
CREATE INDEX "document_work_items_document_idx" ON "document_work_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_work_items_work_item_idx" ON "document_work_items" USING btree ("work_item_id");