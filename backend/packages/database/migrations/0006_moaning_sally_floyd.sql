DROP INDEX "github_commits_repo_branch_idx";--> statement-breakpoint
DROP INDEX "github_commits_committed_at_idx";--> statement-breakpoint
DROP INDEX "github_events_repo_id_idx";--> statement-breakpoint
DROP INDEX "github_events_created_at_idx";--> statement-breakpoint
DROP INDEX "github_events_event_type_idx";--> statement-breakpoint
DROP INDEX "github_events_delivery_id_idx";--> statement-breakpoint
DROP INDEX "github_installations_installation_id_idx";--> statement-breakpoint
DROP INDEX "github_installations_account_login_idx";--> statement-breakpoint
DROP INDEX "github_pull_requests_repo_number_idx";--> statement-breakpoint
DROP INDEX "github_pull_requests_state_idx";--> statement-breakpoint
DROP INDEX "github_pull_requests_repo_id_idx";--> statement-breakpoint
DROP INDEX "github_workflow_runs_repo_run_id_idx";--> statement-breakpoint
DROP INDEX "github_workflow_runs_repo_id_idx";--> statement-breakpoint
DROP INDEX "github_workflow_runs_branch_idx";--> statement-breakpoint
DROP INDEX "repo_installation_links_repo_id_idx";--> statement-breakpoint
DROP INDEX "repo_installation_links_installation_id_idx";--> statement-breakpoint
ALTER TABLE "github_events" ALTER COLUMN "action" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "github_events" ALTER COLUMN "github_delivery_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "github_installations" ALTER COLUMN "account_type" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "github_installations" ALTER COLUMN "repository_selection" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ALTER COLUMN "title" SET DATA TYPE varchar(512);--> statement-breakpoint
ALTER TABLE "github_pull_requests" ALTER COLUMN "review_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ALTER COLUMN "ci_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "github_workflow_runs" ALTER COLUMN "name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "repo_installation_links" ALTER COLUMN "github_repo_full_name" SET DATA TYPE varchar(512);--> statement-breakpoint
CREATE UNIQUE INDEX "github_prs_repo_number_idx" ON "github_pull_requests" USING btree ("repo_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "github_workflow_runs_repo_run_idx" ON "github_workflow_runs" USING btree ("repo_id","run_id");--> statement-breakpoint
ALTER TABLE "github_workflow_runs" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "repo_installation_links" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id");