ALTER TABLE "feedback_sources" DROP CONSTRAINT "feedback_sources_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback_items" DROP CONSTRAINT "feedback_items_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback_clusters" DROP CONSTRAINT "feedback_clusters_project_id_projects_id_fk";
--> statement-breakpoint
DROP INDEX "feedback_sources_project_id_idx";--> statement-breakpoint
DROP INDEX "feedback_items_project_status_created_idx";--> statement-breakpoint
DROP INDEX "feedback_clusters_project_id_status_idx";--> statement-breakpoint
CREATE INDEX "feedback_items_status_created_idx" ON "feedback_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_clusters_status_idx" ON "feedback_clusters" USING btree ("status");--> statement-breakpoint
ALTER TABLE "feedback_sources" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "feedback_items" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "feedback_clusters" DROP COLUMN "project_id";