ALTER TABLE "feedback_items" DROP CONSTRAINT "feedback_items_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback_clusters" DROP CONSTRAINT "feedback_clusters_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback_topics" DROP CONSTRAINT "feedback_topics_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback_topic_proposals" DROP CONSTRAINT "feedback_topic_proposals_project_id_projects_id_fk";
--> statement-breakpoint
DROP INDEX "feedback_items_project_id_idx";--> statement-breakpoint
DROP INDEX "feedback_clusters_project_id_idx";--> statement-breakpoint
DROP INDEX "feedback_topics_slug_project_idx";--> statement-breakpoint
DROP INDEX "feedback_topics_project_status_idx";--> statement-breakpoint
DROP INDEX "ftp_project_status_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_topics_slug_idx" ON "feedback_topics" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "feedback_topics_status_idx" ON "feedback_topics" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ftp_status_idx" ON "feedback_topic_proposals" USING btree ("status");--> statement-breakpoint
ALTER TABLE "feedback_items" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "feedback_clusters" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "feedback_topics" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "feedback_topic_proposals" DROP COLUMN "project_id";