CREATE TYPE "public"."ask_ingestion_status" AS ENUM('idle', 'running', 'error', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ask_source_type" AS ENUM('work_item', 'document', 'event', 'commit');--> statement-breakpoint
CREATE TABLE "ask_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"source_type" "ask_source_type" NOT NULL,
	"source_id" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text,
	"excerpt" text,
	"search_vector" "tsvector",
	"feature_id" uuid,
	"source_timestamp" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"token_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_ingestion_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"source_type" text NOT NULL,
	"last_processed_at" timestamp with time zone,
	"last_processed_id" text,
	"items_processed" integer DEFAULT 0,
	"status" "ask_ingestion_status" DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_documents" ADD CONSTRAINT "ask_documents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_documents" ADD CONSTRAINT "ask_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_documents" ADD CONSTRAINT "ask_documents_feature_id_work_items_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_chunks" ADD CONSTRAINT "ask_chunks_ask_document_id_ask_documents_id_fk" FOREIGN KEY ("ask_document_id") REFERENCES "public"."ask_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_ingestion_state" ADD CONSTRAINT "ask_ingestion_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_ingestion_state" ADD CONSTRAINT "ask_ingestion_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ask_documents_source_type_source_id_idx" ON "ask_documents" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "ask_documents_project_idx" ON "ask_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ask_documents_feature_idx" ON "ask_documents" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "ask_documents_source_type_idx" ON "ask_documents" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "ask_documents_source_timestamp_idx" ON "ask_documents" USING btree ("source_timestamp");--> statement-breakpoint
CREATE INDEX "ask_documents_organization_idx" ON "ask_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ask_chunks_document_idx" ON "ask_chunks" USING btree ("ask_document_id");--> statement-breakpoint
CREATE INDEX "ask_chunks_document_chunk_idx" ON "ask_chunks" USING btree ("ask_document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ask_ingestion_state_org_project_source_idx" ON "ask_ingestion_state" USING btree ("organization_id","project_id","source_type");