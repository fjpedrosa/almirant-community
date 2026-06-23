ALTER TABLE "planning_session_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "planning_session_messages" CASCADE;--> statement-breakpoint
DROP TYPE "public"."planning_message_role";