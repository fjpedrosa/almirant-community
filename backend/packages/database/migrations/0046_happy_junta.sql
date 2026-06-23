CREATE TYPE "public"."quota_alert_type" AS ENUM('warning_80', 'warning_90', 'exceeded');--> statement-breakpoint
CREATE TYPE "public"."quota_type" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"state" varchar(255) NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "provider_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"quota_type" "quota_type" NOT NULL,
	"max_tokens" bigint,
	"max_cost_usd" numeric(10, 6),
	"max_requests" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_quota_id" uuid NOT NULL,
	"alert_type" "quota_alert_type" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"message" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_usage_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"period_type" "quota_type" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";--> statement-breakpoint
ALTER TABLE "task_id_counters" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "task_id_counters" DROP CONSTRAINT "task_id_counters_pkey";--> statement-breakpoint
ALTER TABLE "task_id_counters" ADD CONSTRAINT "task_id_counters_prefix_organization_id_pk" PRIMARY KEY("prefix","organization_id");--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "document_categories" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_quotas" ADD CONSTRAINT "provider_quotas_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_alerts" ADD CONSTRAINT "quota_alerts_provider_quota_id_provider_quotas_id_fk" FOREIGN KEY ("provider_quota_id") REFERENCES "public"."provider_quotas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_quotas_provider_idx" ON "provider_quotas" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "provider_quotas_organization_id_idx" ON "provider_quotas" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quota_alerts_provider_quota_idx" ON "quota_alerts" USING btree ("provider_quota_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_usage_periods_provider_period_idx" ON "quota_usage_periods" USING btree ("provider","period_type","period_start");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_id_counters" ADD CONSTRAINT "task_id_counters_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_organization_id_idx" ON "companies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leads_organization_id_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "funnels_organization_id_idx" ON "funnels" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_organization_id_idx" ON "tags" USING btree ("name","organization_id");--> statement-breakpoint
CREATE INDEX "tags_organization_id_idx" ON "tags" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhooks_organization_id_idx" ON "webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_jobs_organization_id_idx" ON "import_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_categories_organization_id_idx" ON "document_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_installations_organization_id_idx" ON "github_installations" USING btree ("organization_id");
