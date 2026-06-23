CREATE TABLE "onboarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"step" text NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_status" ADD COLUMN "skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_status" ADD COLUMN "skipped_steps" jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_events_user_created_at_idx" ON "onboarding_events" USING btree ("user_id","created_at");