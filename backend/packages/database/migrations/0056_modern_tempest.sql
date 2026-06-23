ALTER TABLE "idea_items" ADD COLUMN "discussed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idea_items_discussed_idx" ON "idea_items" USING btree ("discussed");