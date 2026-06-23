CREATE TABLE "discord_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_connection_id" uuid NOT NULL,
	"project_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_work_item_created" boolean DEFAULT true NOT NULL,
	"notify_work_item_moved" boolean DEFAULT true NOT NULL,
	"notify_work_item_assigned" boolean DEFAULT true NOT NULL,
	"notify_work_item_done" boolean DEFAULT true NOT NULL,
	"notify_work_item_comment" boolean DEFAULT true NOT NULL,
	"notify_sprint_started" boolean DEFAULT true NOT NULL,
	"notify_sprint_closed" boolean DEFAULT true NOT NULL,
	"notify_milestone_completed" boolean DEFAULT true NOT NULL,
	"notify_pr_opened" boolean DEFAULT true NOT NULL,
	"notify_pr_merged" boolean DEFAULT true NOT NULL,
	"notify_ci_failed" boolean DEFAULT true NOT NULL,
	"notify_agent_job_completed" boolean DEFAULT true NOT NULL,
	"notify_agent_job_failed" boolean DEFAULT true NOT NULL,
	"notify_seed_promoted" boolean DEFAULT true NOT NULL,
	"notify_work_item_updated" boolean DEFAULT false NOT NULL,
	"notify_work_item_deleted" boolean DEFAULT false NOT NULL,
	"notify_comment_added" boolean DEFAULT false NOT NULL,
	"notify_attachment_added" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_notification_preferences" ADD CONSTRAINT "discord_notification_preferences_discord_connection_id_discord_connections_id_fk" FOREIGN KEY ("discord_connection_id") REFERENCES "public"."discord_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discord_notification_preferences" ADD CONSTRAINT "discord_notification_preferences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_notif_prefs_connection_project_unique" ON "discord_notification_preferences" USING btree ("discord_connection_id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_notif_prefs_connection_org_unique" ON "discord_notification_preferences" USING btree ("discord_connection_id") WHERE "discord_notification_preferences"."project_id" IS NULL;
