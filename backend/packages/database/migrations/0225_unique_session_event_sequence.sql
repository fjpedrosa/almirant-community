-- Expand-only migration: every pre-existing row remains legacy (NULL) and no
-- historical event is deleted or resequenced. Adding a nullable column without
-- a default is a metadata-only operation on supported PostgreSQL versions.
--
-- Production rehearsal: apply this migration to a production-shaped restore,
-- verify the row count and legacy duplicate-group count are unchanged, then
-- verify the partial index predicate below. Rollback is non-destructive:
-- DROP INDEX "session_events_durable_job_seq_unique_idx";
-- ALTER TABLE "session_events" DROP COLUMN "sequence_protocol_version";
ALTER TABLE "session_events"
	ADD COLUMN IF NOT EXISTS "sequence_protocol_version" varchar(32);
--> statement-breakpoint
-- Only producers that explicitly opt into durable.v2 receive atomic idempotency.
-- The index build scans existing rows but indexes none of the legacy NULL rows;
-- rehearse lock duration on a production-shaped restore before rollout.
CREATE UNIQUE INDEX IF NOT EXISTS "session_events_durable_job_seq_unique_idx"
	ON "session_events" USING btree ("agent_job_id", "sequence_num")
	WHERE "sequence_protocol_version" = 'durable.v2';
