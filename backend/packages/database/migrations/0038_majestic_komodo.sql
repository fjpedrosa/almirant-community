CREATE TABLE "vercel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"team_id" varchar(255),
	"team_name" varchar(255),
	"encrypted_access_token" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"token_prefix" varchar(10) NOT NULL,
	"scope" text,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vercel_connections" ADD CONSTRAINT "vercel_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;