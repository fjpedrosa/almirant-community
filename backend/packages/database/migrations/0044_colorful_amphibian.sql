ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_organization_id_idx" ON "projects" USING btree ("organization_id");
