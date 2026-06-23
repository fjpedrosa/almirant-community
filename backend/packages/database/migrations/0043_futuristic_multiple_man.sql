DO $$ BEGIN CREATE TYPE "public"."auth_method" AS ENUM('api_key', 'oauth', 'setup_token'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "auth_method" "auth_method" DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "encrypted_refresh_token" text;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "refresh_token_iv" text;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "refresh_token_auth_tag" text;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN IF NOT EXISTS "oauth_scopes" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
