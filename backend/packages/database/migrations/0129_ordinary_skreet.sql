ALTER TABLE "agent_job_logs" ADD COLUMN "content_type" varchar(32) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
CREATE INDEX "agent_job_logs_job_transcript_seq_idx" ON "agent_job_logs" USING btree ("job_id","seq") WHERE phase = 'transcript';--> statement-breakpoint
CREATE INDEX "agent_job_logs_job_content_type_idx" ON "agent_job_logs" USING btree ("job_id","content_type","seq") WHERE phase = 'transcript';
