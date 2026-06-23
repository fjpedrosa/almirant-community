ALTER TABLE "feedback_items" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD CONSTRAINT "feedback_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_items_project_id_idx" ON "feedback_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "feedback_clusters_project_id_idx" ON "feedback_clusters" USING btree ("project_id");