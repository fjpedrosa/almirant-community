ALTER TABLE "agent_jobs" ADD COLUMN "dialog_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "dialog_subject" varchar(200);--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "idle_grace_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_dialog_owner_user_id_user_id_fk" FOREIGN KEY ("dialog_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;