-- Consolidate duplicate worker_registrations by hostname.
-- Keep only the most recently updated row per hostname.
DELETE FROM "worker_registrations" a
  USING "worker_registrations" b
  WHERE a.hostname = b.hostname
    AND a.id <> b.id
    AND a.updated_at < b.updated_at;--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN "current_ip" text;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_registrations_hostname_unique_idx" ON "worker_registrations" USING btree ("hostname");
