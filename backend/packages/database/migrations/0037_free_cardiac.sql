CREATE TYPE "public"."column_role" AS ENUM('backlog', 'todo', 'in_progress', 'review', 'testing', 'done', 'other');--> statement-breakpoint
ALTER TABLE "board_columns" ADD COLUMN "role" "column_role" DEFAULT 'other' NOT NULL;--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'backlog'
WHERE lower(trim("name")) LIKE '%backlog%';--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'todo'
WHERE "role" = 'other'
  AND (
    lower(trim("name")) LIKE '%to do%'
    OR lower(trim("name")) = 'todo'
  );--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'in_progress'
WHERE "role" = 'other'
  AND (
    lower(trim("name")) LIKE '%in progress%'
    OR lower(trim("name")) LIKE '%en progreso%'
    OR lower(trim("name")) = 'doing'
  );--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'review'
WHERE "role" = 'other'
  AND (
    lower(trim("name")) LIKE '%review%'
    OR lower(trim("name")) LIKE '%revision%'
  );--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'testing'
WHERE "role" = 'other'
  AND (
    lower(trim("name")) LIKE '%testing%'
    OR lower(trim("name")) LIKE '%test%'
    OR lower(trim("name")) = 'qa'
  );--> statement-breakpoint

UPDATE "board_columns"
SET "role" = 'done'
WHERE "role" = 'other'
  AND (
    lower(trim("name")) LIKE '%done%'
    OR lower(trim("name")) LIKE '%hecho%'
    OR lower(trim("name")) LIKE '%completed%'
  );--> statement-breakpoint

UPDATE "board_columns"
SET "is_done" = true
WHERE "role" = 'done';
