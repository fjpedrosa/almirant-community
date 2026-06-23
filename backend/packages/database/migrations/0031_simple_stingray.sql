CREATE TYPE "public"."conversation_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" uuid,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_work_item_ids" jsonb DEFAULT '[]'::jsonb,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_api_keys" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_project_idx" ON "ai_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_board_idx" ON "ai_conversations" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_status_idx" ON "ai_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_conversations_created_at_idx" ON "ai_conversations" USING btree ("created_at");