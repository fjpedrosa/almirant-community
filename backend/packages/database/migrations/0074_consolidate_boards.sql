-- Data migration: Consolidate boards
-- Move all parent items from "Product Roadmap" (63a868e9) to "Desarrollo" (fa0fa9fe)
-- All items in Product Roadmap are parent types (boardColumnId=NULL), so only boardId changes.
-- Also remap JS-24, JS-25 from secondary Desarrollo board (ec1e328b) to primary (fa0fa9fe).

-- Step 1: Move all 233 parent items from Product Roadmap to Desarrollo
UPDATE "work_items"
SET "board_id" = 'fa0fa9fe-314e-4ea6-b611-deccd7b4d8e6'
WHERE "board_id" = '63a868e9-9e97-4e8d-81ae-6bc035c370d7';--> statement-breakpoint

-- Step 2: Remap JS-24, JS-25 from board ec1e328b to fa0fa9fe, matching column by role
UPDATE "work_items"
SET "board_id" = 'fa0fa9fe-314e-4ea6-b611-deccd7b4d8e6',
    "board_column_id" = (
      SELECT bc2."id" FROM "board_columns" bc2
      WHERE bc2."board_id" = 'fa0fa9fe-314e-4ea6-b611-deccd7b4d8e6'
        AND bc2."role" = (
          SELECT bc1."role" FROM "board_columns" bc1
          WHERE bc1."id" = "work_items"."board_column_id"
        )
      LIMIT 1
    )
WHERE "board_id" = 'ec1e328b-c370-4876-b8cd-f3669e65e014'
  AND "task_id" IN ('JS-24', 'JS-25');
