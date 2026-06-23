CREATE TABLE "discord_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"guild_name" varchar(255),
	"default_channel_id" varchar(255),
	"default_channel_name" varchar(255),
	"encrypted_access_token" text,
	"access_token_iv" text,
	"access_token_auth_tag" text,
	"encrypted_refresh_token" text,
	"refresh_token_iv" text,
	"refresh_token_auth_tag" text,
	"bot_joined_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_project_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_connection_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"channel_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_connections" ADD CONSTRAINT "discord_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_project_channels" ADD CONSTRAINT "discord_project_channels_discord_connection_id_discord_connections_id_fk" FOREIGN KEY ("discord_connection_id") REFERENCES "public"."discord_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_project_channels" ADD CONSTRAINT "discord_project_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_connections_organization_id_idx" ON "discord_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_connections_org_guild_unique" ON "discord_connections" USING btree ("organization_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_project_channels_connection_project_unique" ON "discord_project_channels" USING btree ("discord_connection_id","project_id");