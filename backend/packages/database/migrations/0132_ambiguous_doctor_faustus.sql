CREATE TABLE "waitlist_thank_you_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "waitlist_tier" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD CONSTRAINT "waitlist_thank_you_sends_user_id_waitlist_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD CONSTRAINT "waitlist_thank_you_sends_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_thank_you_sends_user_tier_unique" ON "waitlist_thank_you_sends" USING btree ("user_id","tier");