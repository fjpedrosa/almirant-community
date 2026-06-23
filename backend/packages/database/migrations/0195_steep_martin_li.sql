CREATE TABLE "manifest_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" varchar(255) NOT NULL,
	"app_name" text NOT NULL,
	"return_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
ALTER TABLE "manifest_states" ADD CONSTRAINT "manifest_states_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_states_expires_at_idx" ON "manifest_states" USING btree ("expires_at");