CREATE TABLE "comment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"content" text NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_by_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comment_versions_comment_id_idx" ON "comment_versions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_versions_edited_at_idx" ON "comment_versions" USING btree ("edited_at");