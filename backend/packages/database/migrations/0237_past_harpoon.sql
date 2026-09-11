CREATE TABLE "pi_openai_connection_leases" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"claim_attempt_id" text NOT NULL,
	"credential_version" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pi_openai_connection_leases_worker_id_check" CHECK ("pi_openai_connection_leases"."worker_id" <> '' AND "pi_openai_connection_leases"."worker_id" = btrim("pi_openai_connection_leases"."worker_id")),
	CONSTRAINT "pi_openai_connection_leases_claim_attempt_id_check" CHECK ("pi_openai_connection_leases"."claim_attempt_id" <> '' AND "pi_openai_connection_leases"."claim_attempt_id" = btrim("pi_openai_connection_leases"."claim_attempt_id"))
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ALTER COLUMN "updated_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "provider_connections" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "pi_openai_connection_leases" ADD CONSTRAINT "pi_openai_connection_leases_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pi_openai_connection_leases" ADD CONSTRAINT "pi_openai_connection_leases_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pi_openai_connection_leases_job_unique_idx" ON "pi_openai_connection_leases" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "pi_openai_connection_leases_expires_at_idx" ON "pi_openai_connection_leases" USING btree ("expires_at");