CREATE TYPE "public"."github_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."github_ci_status" AS ENUM('pending', 'queued', 'in_progress', 'success', 'failure', 'cancelled', 'skipped', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."github_event_type" AS ENUM('push', 'pull_request', 'pull_request_review', 'check_run', 'workflow_run', 'installation', 'deployment');--> statement-breakpoint
CREATE TYPE "public"."github_pr_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."github_review_status" AS ENUM('pending', 'approved', 'changes_requested', 'commented', 'dismissed');--> statement-breakpoint
CREATE TABLE "github_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"sha" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"author_login" varchar(255),
	"author_name" varchar(255),
	"author_avatar_url" text,
	"branch" varchar(255),
	"additions" integer DEFAULT 0,
	"deletions" integer DEFAULT 0,
	"committed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"event_type" "github_event_type" NOT NULL,
	"action" varchar(50),
	"actor_login" varchar(255),
	"actor_avatar_url" text,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"github_delivery_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_type" "github_account_type" DEFAULT 'organization' NOT NULL,
	"account_avatar_url" text,
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"repository_selection" varchar(50) DEFAULT 'all',
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" "github_pr_state" DEFAULT 'open' NOT NULL,
	"author_login" varchar(255),
	"author_avatar_url" text,
	"labels" jsonb DEFAULT '[]'::jsonb,
	"review_status" "github_review_status" DEFAULT 'pending',
	"ci_status" "github_ci_status" DEFAULT 'pending',
	"base_branch" varchar(255),
	"head_branch" varchar(255),
	"additions" integer DEFAULT 0,
	"deletions" integer DEFAULT 0,
	"html_url" text,
	"is_draft" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "github_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" bigint NOT NULL,
	"name" varchar(500),
	"status" varchar(50),
	"conclusion" varchar(50),
	"branch" varchar(255),
	"head_sha" varchar(40),
	"html_url" text,
	"event" varchar(50),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_installation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"github_repo_full_name" varchar(500) NOT NULL,
	"default_branch" varchar(255) DEFAULT 'main',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_commits" ADD CONSTRAINT "github_commits_repo_id_project_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_events" ADD CONSTRAINT "github_events_repo_id_project_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_repo_id_project_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_workflow_runs" ADD CONSTRAINT "github_workflow_runs_repo_id_project_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_installation_links" ADD CONSTRAINT "repo_installation_links_repo_id_project_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_installation_links" ADD CONSTRAINT "repo_installation_links_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_commits_repo_sha_idx" ON "github_commits" USING btree ("repo_id","sha");--> statement-breakpoint
CREATE INDEX "github_commits_repo_branch_idx" ON "github_commits" USING btree ("repo_id","branch");--> statement-breakpoint
CREATE INDEX "github_commits_committed_at_idx" ON "github_commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX "github_events_repo_id_idx" ON "github_events" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "github_events_created_at_idx" ON "github_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "github_events_event_type_idx" ON "github_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "github_events_delivery_id_idx" ON "github_events" USING btree ("github_delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_installation_id_idx" ON "github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_login_idx" ON "github_installations" USING btree ("account_login");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_requests_repo_number_idx" ON "github_pull_requests" USING btree ("repo_id","number");--> statement-breakpoint
CREATE INDEX "github_pull_requests_state_idx" ON "github_pull_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "github_pull_requests_repo_id_idx" ON "github_pull_requests" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_workflow_runs_repo_run_id_idx" ON "github_workflow_runs" USING btree ("repo_id","run_id");--> statement-breakpoint
CREATE INDEX "github_workflow_runs_repo_id_idx" ON "github_workflow_runs" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "github_workflow_runs_branch_idx" ON "github_workflow_runs" USING btree ("branch");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_installation_links_repo_id_idx" ON "repo_installation_links" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "repo_installation_links_installation_id_idx" ON "repo_installation_links" USING btree ("installation_id");