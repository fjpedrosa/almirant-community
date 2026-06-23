CREATE TYPE "public"."currency_code" AS ENUM('EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'MXN', 'BRL', 'CLP', 'COP', 'ARS');--> statement-breakpoint
CREATE TYPE "public"."expense_recurrence" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."invoice_processing_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."agent_job_type" ADD VALUE 'validation';--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"parent_id" uuid,
	"name" varchar(200) NOT NULL,
	"icon" varchar(100),
	"color" varchar(20),
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"category_id" uuid,
	"paid_by_user_id" text,
	"recurring_expense_id" uuid,
	"title" varchar(500) NOT NULL,
	"description" text,
	"vendor" varchar(300),
	"amount" numeric(12, 2) NOT NULL,
	"currency" "currency_code" DEFAULT 'EUR' NOT NULL,
	"amount_eur" numeric(12, 2),
	"exchange_rate" numeric(16, 8),
	"status" "expense_status" DEFAULT 'draft' NOT NULL,
	"expense_date" timestamp with time zone NOT NULL,
	"invoice_file_name" varchar(500),
	"invoice_file_url" text,
	"invoice_file_size" integer,
	"invoice_mime_type" varchar(100),
	"invoice_processing_status" "invoice_processing_status",
	"invoice_processed_data" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_tags" (
	"expense_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"category_id" uuid,
	"paid_by_user_id" text,
	"title" varchar(500) NOT NULL,
	"vendor" varchar(300),
	"amount" numeric(12, 2) NOT NULL,
	"currency" "currency_code" DEFAULT 'EUR' NOT NULL,
	"recurrence" "expense_recurrence" NOT NULL,
	"anchor_date" timestamp with time zone NOT NULL,
	"next_renewal_date" timestamp with time zone,
	"alert_days_before" integer DEFAULT 7,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" "currency_code" NOT NULL,
	"to_currency" "currency_code" NOT NULL,
	"rate" numeric(16, 8) NOT NULL,
	"rate_date" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "nightly_validation" jsonb DEFAULT '{"enabled":false,"startHour":1,"endHour":6,"timezone":"Europe/Madrid"}'::jsonb;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_user_id_user_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_tags" ADD CONSTRAINT "expense_tags_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_tags" ADD CONSTRAINT "expense_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_paid_by_user_id_user_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_org_idx" ON "expense_categories" USING btree ("name","organization_id");--> statement-breakpoint
CREATE INDEX "expense_categories_org_idx" ON "expense_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expense_categories_parent_idx" ON "expense_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "expenses_org_idx" ON "expenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expenses_project_idx" ON "expenses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_paid_by_idx" ON "expenses" USING btree ("paid_by_user_id");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expenses_currency_idx" ON "expenses" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_vendor_idx" ON "expenses" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "expenses_recurring_idx" ON "expenses" USING btree ("recurring_expense_id");--> statement-breakpoint
CREATE INDEX "expenses_archived_idx" ON "expenses" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "expenses_org_status_date_idx" ON "expenses" USING btree ("organization_id","status","expense_date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_tags_unique_idx" ON "expense_tags" USING btree ("expense_id","tag_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_org_idx" ON "recurring_expenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_project_idx" ON "recurring_expenses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_category_idx" ON "recurring_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_paid_by_idx" ON "recurring_expenses" USING btree ("paid_by_user_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_active_idx" ON "recurring_expenses" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "recurring_expenses_renewal_idx" ON "recurring_expenses" USING btree ("next_renewal_date");--> statement-breakpoint
CREATE INDEX "recurring_expenses_vendor_idx" ON "recurring_expenses" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "recurring_expenses_org_active_renewal_idx" ON "recurring_expenses" USING btree ("organization_id","is_active","next_renewal_date");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_rates_pair_date_idx" ON "currency_rates" USING btree ("from_currency","to_currency","rate_date");