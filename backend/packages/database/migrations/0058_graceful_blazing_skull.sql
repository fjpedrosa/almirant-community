CREATE TYPE "public"."waitlist_action_type" AS ENUM('email_confirmed', 'profile_completed', 'share_x', 'share_linkedin', 'referral_confirmed');--> statement-breakpoint
CREATE TYPE "public"."waitlist_email_token_type" AS ENUM('confirm_email');--> statement-breakpoint
CREATE TYPE "public"."waitlist_tier" AS ENUM('none', 'early_access', 'one_month_pro');--> statement-breakpoint
CREATE TYPE "public"."waitlist_user_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
CREATE TABLE "waitlist_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action_type" "waitlist_action_type" NOT NULL,
	"dedupe_key" varchar(191) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_type" "waitlist_email_token_type" DEFAULT 'confirm_email' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"source" varchar(32) DEFAULT 'unknown' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_normalized" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" "waitlist_user_status" DEFAULT 'pending' NOT NULL,
	"referral_code" varchar(32) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"tier" "waitlist_tier" DEFAULT 'none' NOT NULL,
	"profile_role" varchar(64),
	"profile_ai_stack" varchar(64),
	"profile_ai_stack_other" varchar(255),
	"profile_vibe_tool" varchar(255),
	"profile_monthly_spend" varchar(64),
	"profile_completed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_actions" ADD CONSTRAINT "waitlist_actions_user_id_waitlist_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_email_tokens" ADD CONSTRAINT "waitlist_email_tokens_user_id_waitlist_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_referrals" ADD CONSTRAINT "waitlist_referrals_referrer_user_id_waitlist_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_referrals" ADD CONSTRAINT "waitlist_referrals_referred_user_id_waitlist_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_actions_dedupe_key_unique" ON "waitlist_actions" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "waitlist_actions_user_action_type_idx" ON "waitlist_actions" USING btree ("user_id","action_type");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_tokens_token_hash_unique" ON "waitlist_email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "waitlist_email_tokens_user_type_consumed_idx" ON "waitlist_email_tokens" USING btree ("user_id","token_type","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_referrals_referred_user_id_unique" ON "waitlist_referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_referrals_referrer_referred_unique" ON "waitlist_referrals" USING btree ("referrer_user_id","referred_user_id");--> statement-breakpoint
CREATE INDEX "waitlist_referrals_referrer_confirmed_idx" ON "waitlist_referrals" USING btree ("referrer_user_id","confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_users_email_normalized_unique" ON "waitlist_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_users_referral_code_unique" ON "waitlist_users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "waitlist_users_status_confirmed_at_idx" ON "waitlist_users" USING btree ("status","confirmed_at");