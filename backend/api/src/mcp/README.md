# MCP Architecture

This document describes the dual-mount MCP architecture separating public
customer-facing tools from internal/back-office tooling.

## Overview

Almirant exposes two MCP endpoints with different access control policies:

| Mount | Path | API Keys | Session Tokens | Required Permission |
|-------|------|----------|----------------|---------------------|
| **Public** | `/mcp` | Allowed | Allowed | None |
| **Internal** | `/mcp/internal` | Rejected | Allowed | `mcp:internal` |

The internal mount is gated by the `MCP_INTERNAL_ENABLED` environment variable
and is disabled by default in production. It only accepts session tokens with
the `mcp:internal` permission in their payload.

## Tool Matrix

### Public Mount (/mcp) - 21 Tool Groups

All tools registered here are available to authenticated users via API keys
or session tokens. No extra permission required beyond valid authentication.

| # | Tool Group | Source File | Description |
|---|------------|-------------|-------------|
| 1 | `registerProjectsTools` | `tools/projects.tools.ts` | Project CRUD and listing |
| 2 | `registerBoardsTools` | `tools/boards.tools.ts` | Kanban board management |
| 3 | `registerWorkItemsTools` | `tools/work-items.tools.ts` | Tasks, bugs, stories |
| 4 | `registerTagsTools` | `tools/tags.tools.ts` | Tag management |
| 5 | `registerDocumentsTools` | `tools/documents.tools.ts` | Document operations |
| 6 | `registerSprintsTools` | `tools/sprints.tools.ts` | Sprint planning |
| 7 | `registerDependenciesTools` | `tools/dependencies.tools.ts` | Work item dependencies |
| 8 | `registerSkillContextTools` | `tools/skill-context.tools.ts` | Skill/context retrieval |
| 9 | `registerQuotaTools` | `tools/quota.tools.ts` | Usage quota queries |
| 10 | `registerIdeasTools` | `tools/ideas.tools.ts` | Idea capture and triage |
| 11 | `registerAuthTools` | `tools/auth.tools.ts` | Auth context info |
| 12 | `registerMilestonesTools` | `tools/milestones.tools.ts` | Milestone tracking |
| 13 | `registerMembersTools` | `tools/members.tools.ts` | Team member queries |
| 14 | `registerTodosTools` | `tools/todos.tools.ts` | Todo list operations |
| 15 | `registerSeedsTools` | `tools/seeds.tools.ts` | Seed data management |
| 16 | `registerExpensesTools` | `tools/expenses.tools.ts` | Expense tracking |
| 17 | `registerCommitTools` | `tools/commits.tools.ts` | Commit metadata |
| 18 | `registerMemoryTools` | `tools/memory.tools.ts` | Agent memory (org-scoped) |
| 19 | `registerWorkItemMemoryTools` | `tools/workitem-memory.tools.ts` | Work item memory |
| 20 | `registerTodoMemoryTools` | `tools/todo-memory.tools.ts` | Todo memory |
| 21 | `registerSeedMemoryTools` | `tools/seed-memory.tools.ts` | Seed memory |

### Internal Mount (/mcp/internal) - 4 Tool Groups

Tools registered here are for back-office operations, debugging, and automation.
Access requires `mcp:internal` permission and a session token (API keys rejected).

| # | Tool Group | Source File | Description |
|---|------------|-------------|-------------|
| 1 | `registerDebugTools` | `tools/debug.tools.ts` | Debugging utilities (mutations require `mcp:debug`) |
| 2 | `registerBugFixAttemptsTools` | `tools/bug-fix-attempts.tools.ts` | Auto-fix attempt tracking |
| 3 | `registerErrorDiagnosisTools` | `tools/error-diagnosis.tools.ts` | Error diagnosis records |
| 4 | `registerAgentJobsTools` | `tools/agent-jobs.tools.ts` | Agent job management |

## How to Register a New Tool

Use this decision tree when adding MCP tools:

```
Is this tool customer-facing?
├── YES → Register in setup/public.ts
│         - Available to all authenticated users
│         - Ensure org-scoped queries (use getOrganizationIdFromExtra)
│
└── NO (back-office, debugging, cross-org analytics)
          → Register in setup/internal.ts
            - Requires mcp:internal permission
            - API keys cannot access
            - Only session tokens with explicit permission
```

### Registration Steps

1. Create your tool file in `tools/your-feature.tools.ts`
2. Export a `registerYourFeatureTools(server: McpServer)` function
3. Add the import and registration call to the appropriate setup file:
   - `setup/public.ts` for customer-facing tools
   - `setup/internal.ts` for back-office/debug tools
4. Run type-check: `cd backend && bun run type-check`

### Org-Scoping Requirements

All public tools MUST scope queries by organization. Pattern:

```typescript
import { getOrganizationIdFromExtra } from "./helpers";

server.tool("my_tool", schema, async (params, extra) => {
  const organizationId = getOrganizationIdFromExtra(extra);
  if (!organizationId) {
    return { content: [{ type: "text", text: "Error: organizationId required" }] };
  }
  // Use organizationId in all database queries
});
```

## Authentication

### Permission Scopes

Four permission scopes are recognized:

| Permission | Description | Default |
|------------|-------------|---------|
| `mcp:read` | Read-only tool access | Yes (all API keys) |
| `mcp:write` | Write operations | Yes (all API keys) |
| `mcp:internal` | Access to `/mcp/internal` mount | No (explicit grant) |
| `mcp:debug` | Mutating debug tools | No (explicit grant) |

### API Key Authentication (Public Mount Only)

API keys authenticate against the public `/mcp` endpoint. The key's
`allowedIssuedPermissions` column determines what permissions are available.

Default API keys have `["mcp:read", "mcp:write"]`. Keys used by the runner
to issue session tokens for internal access need explicit grants.

### Session Token Authentication (Both Mounts)

Session tokens are short-lived JWTs issued by the runner via
`POST /workers/session-token`. The token's `permissions` array is validated
against the mount's `requiredPermission`.

Token format: `st_<jwt>` (prefix identifies session tokens vs API keys)

Authentication flow:

```
Request with Authorization: Bearer <token>
      │
      ├── Token starts with "st_"?
      │   ├── YES → Verify JWT signature
      │   │         Check permissions array for requiredPermission
      │   │         Return authInfo with organizationId, projectId, permissions
      │   │
      │   └── NO → Validate as API key (rejected on internal mount)
```

## How to Provision an API Key with mcp:internal

API keys that need to issue session tokens with `mcp:internal` permission
require explicit configuration of `allowedIssuedPermissions`.

### SQL Reference

```sql
-- Grant mcp:internal permission to an existing API key
UPDATE api_keys
SET allowed_issued_permissions = ARRAY['mcp:read', 'mcp:write', 'mcp:internal']::text[]
WHERE key_prefix = 'almi_xxx';

-- Verify the update
SELECT name, key_prefix, allowed_issued_permissions
FROM api_keys
WHERE key_prefix = 'almi_xxx';
```

### Database Constraints

The `api_keys` table has a CHECK constraint that only allows valid permissions:

```sql
CHECK (allowed_issued_permissions <@ ARRAY['mcp:read','mcp:write','mcp:internal','mcp:debug']::text[])
```

Attempting to insert invalid permission strings will fail.

## How to Issue a Session Token

The runner requests scoped session tokens via the `/workers/session-token`
endpoint. This allows agent containers to access MCP with limited permissions
instead of using the global runner API key.

### Endpoint

```
POST /workers/session-token
Authorization: Bearer <runner-api-key>
Content-Type: application/json

{
  "projectId": "uuid-of-project",
  "organizationId": "uuid-of-organization",
  "jobId": "uuid-of-agent-job",          // Optional: resolves actor userId
  "ttlSeconds": 3600,                     // Optional: 1-86400, default 3600
  "permissions": ["mcp:read", "mcp:write", "mcp:internal"],  // Optional
  "sessionType": "agent"                  // Optional: "agent" | "worker"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "token": "<session-token>",
    "expiresAt": "2026-04-15T19:00:00.000Z",
    "projectId": "uuid-of-project",
    "organizationId": "uuid-of-organization",
    "userId": "uuid-of-actor"
  }
}
```

### Permission Validation

The endpoint validates that requested permissions are within the API key's
`allowedIssuedPermissions`. Attempting to request `mcp:internal` with a
standard API key will return 403:

```json
{
  "success": false,
  "error": "API key not authorized to issue permissions: mcp:internal"
}
```

## How to Run the Cross-Org Test

The cross-org isolation test verifies that tools properly scope data by
organization, preventing data leakage between tenants.

Test file: `tools/cross-org-isolation.test.ts` (planned)

Test structure:

1. Create two test organizations (Org A, Org B)
2. Authenticate as Org A, create test data via MCP tools
3. Authenticate as Org B, attempt to read Org A's data
4. Assert that Org B cannot see Org A's data

Run tests:

```bash
cd backend/api
bun test src/mcp/tools/cross-org-isolation.test.ts
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_INTERNAL_ENABLED` | Enable `/mcp/internal` mount | `false` |
| `ENCRYPTION_KEY` | Secret for signing session tokens (64-char hex) | Required |

### Health Check

The MCP health endpoint is unauthenticated and reports server status:

```
GET /mcp/health

{
  "status": "ok",
  "uptimeMs": 123456,
  "activeRequests": 2,
  "totalRequests": 1000,
  "failedRequests": 5
}
```

## Related Documentation

- Memory Tools Classification: `tools/MEMORY_TOOLS_CLASSIFICATION.md`
- Session Token Service: `shared/services/session-token.ts`
- Authentication Middleware: `auth/authenticate.ts`
- Epic: A-E-84 (MCP Mount Segregation)
