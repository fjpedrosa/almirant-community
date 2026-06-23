CREATE TABLE "scheduled_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_succeeded" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD CONSTRAINT "scheduled_agent_runs_config_id_scheduled_agent_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scheduled_agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD CONSTRAINT "scheduled_agent_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_agent_runs_config_started_idx" ON "scheduled_agent_runs" USING btree ("config_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_agent_runs_status_idx" ON "scheduled_agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduled_agent_runs_organization_id_idx" ON "scheduled_agent_runs" USING btree ("organization_id");