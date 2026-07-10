-- Custom SQL migration file, put your code below! --

-- Normalize persisted ai_model values to their canonical (lowercase) catalog id.
--
-- Agents saved via MCP calls or clients that sent the model's display name
-- persisted values like "GLM-5.2" instead of the catalog id "glm-5.2". Because
-- the AI Model <Select> compares against the lowercase ids, the stored value
-- did not match any option and the form fell back to the "Select model"
-- placeholder on edit.
--
-- Every catalog model id is lowercase, so lowercasing is safe and idempotent;
-- only rows whose value differs from its lowercase form are touched.
UPDATE "scheduled_agent_configs"
SET "ai_model" = lower("ai_model")
WHERE "ai_model" IS NOT NULL
  AND "ai_model" <> lower("ai_model");
