CREATE TABLE "user_usage_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period" varchar(7) NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"implement_seconds" integer DEFAULT 0 NOT NULL,
	"validate_seconds" integer DEFAULT 0 NOT NULL,
	"planning_seconds" integer DEFAULT 0 NOT NULL,
	"review_seconds" integer DEFAULT 0 NOT NULL,
	"chat_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "user_usage_summaries" ADD CONSTRAINT "user_usage_summaries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_usage_summaries" ADD CONSTRAINT "user_usage_summaries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_usage_summaries_org_user_period_idx" ON "user_usage_summaries" USING btree ("organization_id","user_id","period");--> statement-breakpoint
CREATE INDEX "user_usage_summaries_org_idx" ON "user_usage_summaries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_usage_summaries_user_idx" ON "user_usage_summaries" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_user_idx" ON "usage_records" USING btree ("user_id");