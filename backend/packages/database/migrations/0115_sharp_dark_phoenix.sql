ALTER TABLE "api_keys" ADD COLUMN "service_account_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_service_account_id_idx" ON "api_keys" USING btree ("service_account_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_check" CHECK ("user_id" IS NOT NULL OR "service_account_id" IS NOT NULL);