CREATE TABLE "plan_review_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"planning_session_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"review_job_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"board_column_id" text NOT NULL,
	"plan_sha256" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"application_lease_id" uuid,
	"application_lease_acquired_at" timestamp with time zone,
	"application_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_review_admissions_sha256_check" CHECK ("plan_review_admissions"."plan_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_review_job_id_agent_jobs_id_fk" FOREIGN KEY ("review_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_review_admissions" ADD CONSTRAINT "plan_review_admissions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_review_admissions_workspace_session_plan_uidx" ON "plan_review_admissions" USING btree ("workspace_id","planning_session_id","plan_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_review_admissions_review_job_uidx" ON "plan_review_admissions" USING btree ("review_job_id");--> statement-breakpoint
CREATE INDEX "plan_review_admissions_workspace_session_created_idx" ON "plan_review_admissions" USING btree ("workspace_id","planning_session_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_review_admissions_status_idx" ON "plan_review_admissions" USING btree ("status");
