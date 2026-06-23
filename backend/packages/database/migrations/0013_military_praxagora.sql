CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"model" varchar(100) NOT NULL,
	"provider" varchar(50) DEFAULT 'anthropic' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"session_type" varchar(50) DEFAULT 'implement' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_sessions_work_item_idx" ON "ai_sessions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "ai_sessions_created_at_idx" ON "ai_sessions" USING btree ("created_at");