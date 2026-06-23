DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    INNER JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'idea_item_type'
      AND enum_value.enumlabel = 'seed'
  ) THEN
    ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
            ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'seed' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'todo' AND "idea_items"."status" IN ('pending', 'done', 'blocked'))
          ));
  ELSE
    ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
            ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
            OR
            ("idea_items"."type" = 'todo' AND "idea_items"."status" IN ('pending', 'done', 'blocked'))
          ));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
