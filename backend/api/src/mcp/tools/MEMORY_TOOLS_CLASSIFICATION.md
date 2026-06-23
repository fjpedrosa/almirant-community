# Memory Tools Cross-Org Classification

Date: 2026-04-15
Branch: almirant/A-E-84
Epic: A-E-84
Task: A-1785

## Method

Static code analysis of 4 memory tool files plus their underlying repository layer.
The planned cross-org integration test file (`cross-org-isolation.test.ts`) does not
exist yet, so classification is based on tracing every tool handler from MCP request
through to Drizzle query.

### Verification approach

1. Each tool handler checked for `getOrganizationIdFromExtra(extra)` call.
2. Each database function checked for `organizationId` in query conditions.
3. Repository function `buildBaseConditions(orgId, filters)` verified to always
   include `eq(agentObservations.organizationId, orgId)` as the first condition (line 99).
4. `createObservation` verified to pass `organizationId` into the INSERT payload,
   and `findActiveDuplicate` scopes duplicate detection by `organizationId` (line 173).
5. `createMemoryTelemetry` verified to store `organizationId` on every telemetry row.

## Classification

| File | Tools | Org-scoped? | Classification | Notes |
|------|-------|-------------|----------------|-------|
| `memory.tools.ts` | `mem_save`, `mem_search`, `mem_context` | Yes | **public** | All 3 handlers call `getOrganizationIdFromExtra`, fail-fast if missing. `mem_save` passes orgId into `createObservation`; `mem_search` passes orgId as first arg to `searchObservations`; `mem_context` passes orgId to `getRecentObservations`. Telemetry also org-scoped. |
| `seed-memory.tools.ts` | `seed_search`, `seed_save` | Yes | **public** | Both handlers call `getOrganizationIdFromExtra`, fail-fast if missing. `seed_search` passes orgId to `searchObservations`; `seed_save` passes orgId to `createObservation`. No system-wide queries. |
| `todo-memory.tools.ts` | `todo_search`, `todo_save` | Yes | **public** | Both handlers call `getOrganizationIdFromExtra`, fail-fast if missing. `todo_search` passes orgId to `searchObservations`; `todo_save` passes orgId to `createObservation`. No system-wide queries. |
| `workitem-memory.tools.ts` | `workitem_search`, `workitem_save` | Yes | **public** | Both handlers call `getOrganizationIdFromExtra`, fail-fast if missing. `workitem_search` passes orgId to `searchObservations`; `workitem_save` passes orgId to `createObservation`. No system-wide queries. |

## Detailed Handler Analysis

### memory.tools.ts (3 tools)

#### mem_save

- Line 130: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 152: `createObservation({ organizationId, ... })` -- org stored in row
- Line 176: `createMemoryTelemetry({ organizationId, ... })` -- telemetry org-scoped
- **Verdict**: Fully org-scoped. No cross-org risk.

#### mem_search

- Line 277: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 293: `searchObservations(organizationId, ...)` -- org is first param, used in `buildBaseConditions`
- Line 307: `createMemoryTelemetry({ organizationId, ... })` -- telemetry org-scoped
- **Verdict**: Fully org-scoped. No cross-org risk.

#### mem_context

- Line 402: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 419: `getRecentObservations(organizationId, ...)` -- org is first param, used in `buildBaseConditions`
- Line 457: `createMemoryTelemetry({ organizationId, ... })` -- telemetry org-scoped
- **Verdict**: Fully org-scoped. No cross-org risk.

### seed-memory.tools.ts (2 tools)

#### seed_search

- Line 68: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 83: `searchObservations(organizationId, ...)` -- org-scoped query
- **Verdict**: Fully org-scoped. No cross-org risk.

#### seed_save

- Line 182: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 222: `createObservation({ organizationId, ... })` -- org stored in row
- **Verdict**: Fully org-scoped. No cross-org risk.

### todo-memory.tools.ts (2 tools)

#### todo_search

- Line 49: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 64: `searchObservations(organizationId, ...)` -- org-scoped query
- **Verdict**: Fully org-scoped. No cross-org risk.

#### todo_save

- Line 154: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 193: `createObservation({ organizationId, ... })` -- org stored in row
- **Verdict**: Fully org-scoped. No cross-org risk.

### workitem-memory.tools.ts (2 tools)

#### workitem_search

- Line 80: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 94: `searchObservations(organizationId, ...)` -- org-scoped query
- Note: Does NOT fallback to `getProjectIdFromExtra` for projectId (uses `params.projectId` only). This is a minor behavioral difference vs other tools but does not affect org isolation.
- **Verdict**: Fully org-scoped. No cross-org risk.

#### workitem_save

- Line 226: `getOrganizationIdFromExtra(extra)` -- extracts org, returns error if missing
- Line 276: `createObservation({ organizationId, ... })` -- org stored in row
- **Verdict**: Fully org-scoped. No cross-org risk.

## Repository Layer Verification

All memory tool handlers use three repository functions from `agent-observation-repository.ts`:

1. **`searchObservations(orgId, query, filters)`** -- `buildBaseConditions(orgId, filters)` always starts with `eq(agentObservations.organizationId, orgId)` (line 99). No bypass possible.

2. **`getRecentObservations(orgId, options)`** -- Same `buildBaseConditions(orgId, options)` pattern. Always org-filtered.

3. **`createObservation(data)`** -- Inserts `organizationId` into the row. Duplicate detection in `findActiveDuplicate` also scopes by `eq(agentObservations.organizationId, data.organizationId)` (line 173).

There are no code paths that skip the `organizationId` condition. The org filter is baked into `buildBaseConditions`, which is used by every read query.

## Minor Observations (non-blocking)

1. **`workitem_search` does not use `getProjectIdFromExtra` fallback**: Unlike the other 8 tools that fall back to the connection's `projectId`, `workitem_search` only filters by project when `params.projectId` is explicitly provided. This means it searches across all projects in the org by default, which may be intentional for cross-project discovery but is a behavioral inconsistency.

2. **`findObservationsByWorkItemId` (repo function, not exposed via MCP)**: This repo function does NOT filter by orgId. It is not used by any of the 4 memory tool files, but if exposed in the future it would be a cross-org risk. Flagging for awareness.

## Conclusion

**All 4 memory tool files are correctly scoped by organization.** Every tool handler:

- Extracts `organizationId` from MCP auth context via `getOrganizationIdFromExtra`
- Fails fast with an error if `organizationId` is missing
- Passes `organizationId` to repository functions that enforce it as a mandatory query condition

**Classification: All 4 files remain PUBLIC.** None need to move to `/mcp/internal`.

**Recommendation for A-1787**: No migration needed for memory tools. When the cross-org integration test is implemented, these tools should pass without modification. The test should verify:

- Org A's `mem_save` data is invisible to Org B's `mem_search`/`mem_context`
- Org A's `seed_save` data is invisible to Org B's `seed_search`
- Org A's `todo_save` data is invisible to Org B's `todo_search`
- Org A's `workitem_save` data is invisible to Org B's `workitem_search`
