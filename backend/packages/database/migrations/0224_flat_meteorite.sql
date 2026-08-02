-- NOTE: Postgres forbids using a newly added enum value in the SAME
-- transaction that added it (error 55P04: "unsafe use of new value of enum
-- type"). migrate-with-validation.ts runs the entire pending migration batch
-- inside one transaction (drizzle-orm/postgres-js's `migrate`), so this
-- ADD VALUE must never be combined, in the same deploy batch, with a
-- follow-up migration (or any DML) that INSERTs/UPDATEs a row using
-- schedule_type = 'once'. If a later migration needs to consume this value,
-- ship it in a SEPARATE deploy after this one has already been applied.
ALTER TYPE "public"."schedule_type" ADD VALUE 'once';