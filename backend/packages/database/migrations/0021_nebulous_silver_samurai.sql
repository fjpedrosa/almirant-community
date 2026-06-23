CREATE TABLE "telegram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"telegram_user_id" text,
	"username" varchar(64),
	"first_name" varchar(255),
	"last_name" varchar(255),
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_user_id_unique" ON "telegram_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_chat_id_unique" ON "telegram_accounts" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_unique" ON "telegram_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_user_id_idx" ON "telegram_link_codes" USING btree ("user_id");