CREATE TYPE "public"."planning_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."planning_session_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "planning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"board_id" uuid,
	"title" text NOT NULL,
	"status" "planning_session_status" DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb,
	"created_by_user_id" text,
	"total_input_tokens" integer DEFAULT 0,
	"total_output_tokens" integer DEFAULT 0,
	"estimated_cost" numeric(10, 6),
	"duration_ms" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "planning_message_role" NOT NULL,
	"content" text NOT NULL,
	"message_type" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_session_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seed_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_session_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"proposed_in_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_messages" ADD CONSTRAINT "planning_session_messages_session_id_planning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_seeds" ADD CONSTRAINT "planning_session_seeds_session_id_planning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_seeds" ADD CONSTRAINT "planning_session_seeds_seed_id_seeds_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_work_items" ADD CONSTRAINT "planning_session_work_items_session_id_planning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_work_items" ADD CONSTRAINT "planning_session_work_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_session_work_items" ADD CONSTRAINT "planning_session_work_items_proposed_in_message_id_planning_session_messages_id_fk" FOREIGN KEY ("proposed_in_message_id") REFERENCES "public"."planning_session_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planning_sessions_organization_idx" ON "planning_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "planning_sessions_project_idx" ON "planning_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "planning_sessions_board_idx" ON "planning_sessions" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "planning_sessions_status_idx" ON "planning_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "planning_sessions_created_by_idx" ON "planning_sessions" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "planning_sessions_created_at_idx" ON "planning_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "planning_sessions_project_created_idx" ON "planning_sessions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "planning_session_messages_session_idx" ON "planning_session_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "planning_session_messages_session_created_idx" ON "planning_session_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "planning_session_messages_type_idx" ON "planning_session_messages" USING btree ("message_type");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_session_seeds_unique_idx" ON "planning_session_seeds" USING btree ("session_id","seed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_session_work_items_unique_idx" ON "planning_session_work_items" USING btree ("session_id","work_item_id");