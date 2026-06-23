CREATE TABLE "document_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_favorites_user_document_unique" UNIQUE("user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_vector" "tsvector";--> statement-breakpoint
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_favorites_user_idx" ON "document_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_favorites_document_idx" ON "document_favorites" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_search_vector_gin_idx" ON "documents" USING gin ("search_vector");--> statement-breakpoint

-- Trigger function: builds tsvector from title (weight A) and content (weight B)
-- Uses both Spanish and English dictionaries for bilingual search support
CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Trigger: auto-update search_vector on INSERT or UPDATE of title/content
CREATE TRIGGER documents_search_vector_trigger
BEFORE INSERT OR UPDATE OF title, content ON documents
FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update();--> statement-breakpoint

-- Backfill: populate search_vector for all existing documents
UPDATE documents SET search_vector =
  setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(content, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(content, '')), 'B');