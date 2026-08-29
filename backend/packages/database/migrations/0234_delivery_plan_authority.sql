CREATE TABLE "delivery_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"stable_key" varchar(255) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_plan_items_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "delivery_plan_items_projection_check" CHECK (("delivery_plan_items"."kind" = 'feature' AND "delivery_plan_items"."work_item_id" IS NULL) OR ("delivery_plan_items"."kind" = 'work_unit' AND "delivery_plan_items"."work_item_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_plan_revision_dependencies" (
	"plan_revision_id" uuid NOT NULL,
	"work_unit_item_id" uuid NOT NULL,
	"blocked_by_work_unit_item_id" uuid NOT NULL,
	"dependency_order" integer NOT NULL,
	CONSTRAINT "delivery_plan_revision_dependencies_plan_revision_id_work_unit_item_id_blocked_by_work_unit_item_id_pk" PRIMARY KEY("plan_revision_id","work_unit_item_id","blocked_by_work_unit_item_id"),
	CONSTRAINT "delivery_plan_revision_dependencies_order_check" CHECK ("delivery_plan_revision_dependencies"."dependency_order" >= 0),
	CONSTRAINT "delivery_plan_revision_dependencies_self_check" CHECK ("delivery_plan_revision_dependencies"."work_unit_item_id" <> "delivery_plan_revision_dependencies"."blocked_by_work_unit_item_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_plan_revision_items" (
	"plan_revision_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"parent_feature_item_id" uuid,
	"item_order" integer NOT NULL,
	"item_sha256" char(64) NOT NULL,
	"item_json" jsonb NOT NULL,
	CONSTRAINT "delivery_plan_revision_items_plan_revision_id_item_id_pk" PRIMARY KEY("plan_revision_id","item_id"),
	CONSTRAINT "delivery_plan_revision_items_parent_check" CHECK ("delivery_plan_revision_items"."parent_feature_item_id" IS NULL OR ("delivery_plan_revision_items"."kind" = 'work_unit' AND "delivery_plan_revision_items"."parent_feature_item_id" <> "delivery_plan_revision_items"."item_id")),
	CONSTRAINT "delivery_plan_revision_items_order_check" CHECK ("delivery_plan_revision_items"."item_order" >= 0),
	CONSTRAINT "delivery_plan_revision_items_sha256_check" CHECK ("delivery_plan_revision_items"."item_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"contract_version" integer NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"content_json" jsonb NOT NULL,
	"source_plan_review_admission_id" uuid,
	"accepted_by_user_id" text,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_plan_revisions_number_check" CHECK ("delivery_plan_revisions"."revision_number" > 0),
	CONSTRAINT "delivery_plan_revisions_contract_check" CHECK ("delivery_plan_revisions"."contract_version" = 1),
	CONSTRAINT "delivery_plan_revisions_sha256_check" CHECK ("delivery_plan_revisions"."content_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"planning_session_id" uuid,
	"creation_key" varchar(255) NOT NULL,
	"creation_request_sha256" char(64) NOT NULL,
	"current_revision_number" integer DEFAULT 0 NOT NULL,
	"lock_version" bigint DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_plans_creation_sha256_check" CHECK ("delivery_plans"."creation_request_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "delivery_plans_revision_lock_check" CHECK ("delivery_plans"."current_revision_number" >= 0 AND "delivery_plans"."lock_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_plan_items" ADD CONSTRAINT "delivery_plan_items_plan_id_delivery_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."delivery_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_items" ADD CONSTRAINT "delivery_plan_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revision_dependencies" ADD CONSTRAINT "delivery_plan_revision_dependencies_work_unit_fk" FOREIGN KEY ("plan_revision_id","work_unit_item_id") REFERENCES "public"."delivery_plan_revision_items"("plan_revision_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revision_dependencies" ADD CONSTRAINT "delivery_plan_revision_dependencies_blocked_by_fk" FOREIGN KEY ("plan_revision_id","blocked_by_work_unit_item_id") REFERENCES "public"."delivery_plan_revision_items"("plan_revision_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revision_items" ADD CONSTRAINT "delivery_plan_revision_items_plan_revision_id_delivery_plan_revisions_id_fk" FOREIGN KEY ("plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revision_items" ADD CONSTRAINT "delivery_plan_revision_items_item_kind_fk" FOREIGN KEY ("item_id","kind") REFERENCES "public"."delivery_plan_items"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revision_items" ADD CONSTRAINT "delivery_plan_revision_items_parent_revision_fk" FOREIGN KEY ("plan_revision_id","parent_feature_item_id") REFERENCES "public"."delivery_plan_revision_items"("plan_revision_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_plan_id_delivery_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."delivery_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_source_plan_review_admission_id_plan_review_admissions_id_fk" FOREIGN KEY ("source_plan_review_admission_id") REFERENCES "public"."plan_review_admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plan_items_plan_stable_key_uidx" ON "delivery_plan_items" USING btree ("plan_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plan_items_work_item_uidx" ON "delivery_plan_items" USING btree ("work_item_id") WHERE "delivery_plan_items"."work_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_plan_revision_dependencies_blocked_by_idx" ON "delivery_plan_revision_dependencies" USING btree ("plan_revision_id","blocked_by_work_unit_item_id");--> statement-breakpoint
CREATE INDEX "delivery_plan_revision_items_item_idx" ON "delivery_plan_revision_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "delivery_plan_revision_items_parent_idx" ON "delivery_plan_revision_items" USING btree ("plan_revision_id","parent_feature_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plan_revisions_plan_number_uidx" ON "delivery_plan_revisions" USING btree ("plan_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plan_revisions_source_admission_uidx" ON "delivery_plan_revisions" USING btree ("source_plan_review_admission_id") WHERE "delivery_plan_revisions"."source_plan_review_admission_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plans_workspace_creation_key_uidx" ON "delivery_plans" USING btree ("workspace_id","creation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plans_planning_session_uidx" ON "delivery_plans" USING btree ("planning_session_id") WHERE "delivery_plans"."planning_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_plans_workspace_project_created_idx" ON "delivery_plans" USING btree ("workspace_id","project_id","created_at");