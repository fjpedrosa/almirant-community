CREATE TYPE "public"."health_service" AS ENUM('api', 'database');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TABLE "health_check_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_name" "health_service" NOT NULL,
	"status" "health_status" NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE boards SET organization_id = (
  SELECT projects.organization_id FROM projects WHERE projects.id = boards.project_id
) WHERE boards.project_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "health_check_service_checked_idx" ON "health_check_records" USING btree ("service_name","checked_at");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;