ALTER TYPE "public"."feedback_cluster_status" ADD VALUE 'investigating' BEFORE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."feedback_cluster_status" ADD VALUE 'fix_ready' BEFORE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."feedback_cluster_status" ADD VALUE 'regression' BEFORE 'dismissed';
