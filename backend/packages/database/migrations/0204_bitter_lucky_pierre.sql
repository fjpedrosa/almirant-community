CREATE TABLE "instance_tailnet_database_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" text DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"auth_method" text,
	"hostname" varchar(63) DEFAULT 'almirant-db' NOT NULL,
	"tag" varchar(128) DEFAULT 'tag:almirant-db' NOT NULL,
	"tailscale_ip" text,
	"tailnet_name" text,
	"last_job_id" text,
	"last_error" text,
	"encrypted_credentials" text,
	"credentials_iv" text,
	"credentials_auth_tag" text,
	"connection_tested_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_tailnet_database_access_singleton_unique_idx" ON "instance_tailnet_database_access" USING btree ("singleton");