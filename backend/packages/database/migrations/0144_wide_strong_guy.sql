CREATE TYPE "public"."project_member_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_project_id_idx" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint

-- Seed project_members from existing organization members
-- For each project that has an organizationId, insert all members of that organization.
-- Organization owners get the "owner" role; all others get "member".
INSERT INTO "project_members" ("project_id", "user_id", "role")
SELECT
  p."id" AS project_id,
  m."user_id" AS user_id,
  CASE
    WHEN m."role" = 'owner' THEN 'owner'::"project_member_role"
    ELSE 'member'::"project_member_role"
  END AS role
FROM "projects" p
JOIN "member" m ON m."organization_id" = p."organization_id"
WHERE p."organization_id" IS NOT NULL
ON CONFLICT DO NOTHING;