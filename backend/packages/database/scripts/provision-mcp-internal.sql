-- =============================================================================
-- Provision mcp:internal permission for internal API keys
-- =============================================================================
-- This script adds 'mcp:internal' to the allowedIssuedPermissions array
-- for internal API keys that need access to the /mcp/internal mount.
--
-- Context:
--   Internal Almirant API keys (used by skills like feedback-bug,
--   auto-debug-failed, and by scheduled agents / runner) currently have
--   the default ['mcp:read','mcp:write'] permissions. They need
--   'mcp:internal' added so they can access tools under /mcp/internal.
--
-- USAGE:
--   1. Run the audit query first to identify target keys
--   2. Review the results and note the UUIDs of keys to update
--   3. Uncomment and run the update on staging first, verify, then prod
--
-- IMPORTANT: Never log or expose the full key_hash
-- =============================================================================

-- Step 1: Audit - List all active API keys and their current permissions
-- Use this to identify which keys are internal (look for names like
-- "almirant-internal", "runner", "worker-auto-fix", service-account keys, etc.)
SELECT
  id,
  name,
  key_prefix,
  organization_id,
  user_id,
  service_account_id,
  allowed_issued_permissions,
  last_used_at,
  created_at
FROM api_keys
WHERE is_active = true
ORDER BY organization_id, name;

-- Step 2: Preview - Identify keys that are missing mcp:internal
-- These are the keys that need the upgrade.
SELECT
  id,
  name,
  key_prefix,
  allowed_issued_permissions
FROM api_keys
WHERE is_active = true
  AND NOT ('mcp:internal' = ANY(allowed_issued_permissions));

-- Step 3: Update - Add mcp:internal to specific keys
-- Option A: Update by specific key ID (preferred for precision)
-- Uncomment and replace <key-id> with the actual UUID from Step 1.
--
-- UPDATE api_keys
-- SET allowed_issued_permissions = array_append(allowed_issued_permissions, 'mcp:internal')
-- WHERE id = '<key-id>'
--   AND is_active = true
--   AND NOT ('mcp:internal' = ANY(allowed_issued_permissions));
--
-- Option B: Update ALL active internal keys at once (use with caution)
-- Uncomment and replace <internal-key-name-pattern> with the actual pattern.
--
-- UPDATE api_keys
-- SET allowed_issued_permissions = array_append(allowed_issued_permissions, 'mcp:internal')
-- WHERE is_active = true
--   AND name IN ('almirant-internal', 'runner', 'worker-auto-fix')
--   AND NOT ('mcp:internal' = ANY(allowed_issued_permissions));

-- Step 4: Verify - Confirm the update was applied correctly
-- Re-run after applying the update to confirm permissions are correct.
SELECT
  id,
  name,
  key_prefix,
  allowed_issued_permissions
FROM api_keys
WHERE is_active = true
ORDER BY name;
