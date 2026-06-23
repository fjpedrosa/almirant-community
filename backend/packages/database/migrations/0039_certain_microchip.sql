CREATE TABLE "onboarding_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"github_completed_at" timestamp with time zone,
	"vercel_completed_at" timestamp with time zone,
	"ai_provider_completed_at" timestamp with time zone,
	"first_project_completed_at" timestamp with time zone,
	"banner_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_status" ADD CONSTRAINT "onboarding_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_status_user_id_unique" ON "onboarding_status" USING btree ("user_id");