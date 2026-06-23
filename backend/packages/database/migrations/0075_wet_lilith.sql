DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_type') THEN CREATE TYPE "public"."entity_type" AS ENUM('idea', 'todo'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'todo_item_status') THEN CREATE TYPE "public"."todo_item_status" AS ENUM('pending', 'in_progress', 'done', 'blocked'); END IF; END $$;--> statement-breakpoint
ALTER TYPE "public"."idea_item_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."idea_item_status" ADD VALUE IF NOT EXISTS 'to_review' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."idea_item_status" ADD VALUE IF NOT EXISTS 'approved' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."idea_item_status" ADD VALUE IF NOT EXISTS 'rejected' BEFORE 'pending';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idea_item_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todo_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "todo_item_status" DEFAULT 'pending' NOT NULL,
	"priority" "priority",
	"owner_user_id" text,
	"created_by_user_id" text,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"triggered_by" varchar(30) DEFAULT 'system' NOT NULL,
	"triggered_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "idea_items" DROP CONSTRAINT IF EXISTS "idea_items_type_status_check"; EXCEPTION WHEN undefined_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "idea_item_tags" ADD CONSTRAINT "idea_item_tags_idea_item_id_idea_items_id_fk" FOREIGN KEY ("idea_item_id") REFERENCES "public"."idea_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "idea_item_tags" ADD CONSTRAINT "idea_item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "entity_comments" ADD CONSTRAINT "entity_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idea_item_tags_unique_idx" ON "idea_item_tags" USING btree ("idea_item_id","tag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_organization_idx" ON "todo_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_project_idx" ON "todo_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_owner_user_idx" ON "todo_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_created_by_user_idx" ON "todo_items" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_status_idx" ON "todo_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_due_date_idx" ON "todo_items" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_items_completed_at_idx" ON "todo_items" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_comments_entity_type_entity_id_idx" ON "entity_comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_comments_user_id_idx" ON "entity_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_comments_created_at_idx" ON "entity_comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_events_entity_type_entity_id_idx" ON "entity_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_events_event_type_idx" ON "entity_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_events_triggered_by_user_idx" ON "entity_events" USING btree ("triggered_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_events_created_at_idx" ON "entity_events" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    INNER JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'idea_item_type'
      AND enum_value.enumlabel = 'seed'
  ) THEN
    ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
            ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'seed' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'todo' AND "idea_items"."status" IN ('pending', 'done', 'blocked'))
          ));
  ELSE
    ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
            ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'todo' AND "idea_items"."status" IN ('pending', 'done', 'blocked'))
          ));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
