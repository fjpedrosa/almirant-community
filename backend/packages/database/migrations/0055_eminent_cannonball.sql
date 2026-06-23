ALTER TABLE "boards" DROP CONSTRAINT "boards_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "boards" DROP COLUMN "project_id";