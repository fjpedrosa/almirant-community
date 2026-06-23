CREATE TABLE "telegram_users" (
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
ALTER TABLE "telegram_users" ADD CONSTRAINT "telegram_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_users_user_id_unique" ON "telegram_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_users_chat_id_unique" ON "telegram_users" USING btree ("chat_id");