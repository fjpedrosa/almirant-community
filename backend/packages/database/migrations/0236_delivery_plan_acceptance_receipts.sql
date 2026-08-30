CREATE TABLE "delivery_plan_acceptance_receipts" (
	"plan_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_sha256" char(64) NOT NULL,
	"revision_id" uuid NOT NULL,
	"response_sha256" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_plan_acceptance_receipts_plan_id_idempotency_key_pk" PRIMARY KEY("plan_id","idempotency_key"),
	CONSTRAINT "delivery_plan_acceptance_receipts_request_sha256_check" CHECK ("delivery_plan_acceptance_receipts"."request_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "delivery_plan_acceptance_receipts_response_sha256_check" CHECK ("delivery_plan_acceptance_receipts"."response_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "delivery_plan_acceptance_receipts" ADD CONSTRAINT "delivery_plan_acceptance_receipts_plan_id_delivery_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."delivery_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_plan_id_id_unique" UNIQUE("plan_id","id");--> statement-breakpoint
ALTER TABLE "delivery_plan_acceptance_receipts" ADD CONSTRAINT "delivery_plan_acceptance_receipts_plan_revision_fk" FOREIGN KEY ("plan_id","revision_id") REFERENCES "public"."delivery_plan_revisions"("plan_id","id") ON DELETE restrict ON UPDATE no action;