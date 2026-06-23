# Runner Dynamic Config Injection: Per-Job org/repo Resolution

> Technical design for eliminating static environment variables from the runner and replacing them with dynamic, per-job configuration resolved from the job payload and Almirant API.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Per-Job Flow Design](#per-job-flow-design)
4. [Job Payload Enrichment](#job-payload-enrichment)
5. [New API Endpoint: `GET /workers/repo-config`](#new-api-endpoint-get-workersrepo-config)
6. [Dynamic MCP URL Construction](#dynamic-mcp-url-construction)
7. [Migration Strategy](#migration-strategy)
8. [Sequence Diagram](#sequence-diagram)

---

## Executive Summary

### Problem

The Almirant runner currently relies on static environment variables (`REPOSITORY_ID`, `REPOSITORY_URL`, `REPOSITORY_BRANCH`, `MCP_URL`, `MCP_API_KEY`) configured at deployment time. This hard-couples a single runner instance to a single organization, project, and repository. The consequence:

- **A runner cannot serve multiple projects or organizations.** Each runner deployment is locked to one repo and one MCP project scope.
- **Scaling requires N runner deployments** for N projects, each with its own `.env` file — operationally expensive and error-prone.
- **MCP URL contains a hardcoded `projectId` query parameter**, making it impossible to scope MCP tools to the correct project when jobs span multiple projects.
- **`MCP_API_KEY` is a long-lived static credential** injected into every agent container, violating least-privilege principles.

### Solution

Move all org/repo/project configuration out of static env vars and into the **job payload**. The runner resolves repository details and MCP configuration dynamically for each job it claims, using data from the job payload (preferred) or a new API endpoint (fallback). Session tokens — already partially implemented — replace static MCP API keys entirely.

The result is a **multi-tenant runner** that can serve any project from any organization, with per-job scoped credentials and zero static repo configuration.

### Relationship to A-1112 (Service Accounts)

This design depends on the service accounts design (A-1112). Specifically:

- `ALMIRANT_API_KEY` transitions from a human user API key to a service account key (`alm_sa_` prefix). This is the only static credential the runner retains — it authenticates the runner process itself, not individual jobs.
- Per-job authentication uses scoped session tokens (already implemented), not the runner-level API key.

---

## Current State Analysis

### Static Environment Variables

| Env Var | Current Usage | Why It Must Become Dynamic | Dynamic Replacement |
|---------|--------------|---------------------------|---------------------|
| `REPOSITORY_ID` | Passed to `buildInjectedEnv()` via `this.config.repository.id`. Used to fetch a GitHub installation token (`workerClient.getGithubToken(repositoryId)`) for cloning private repos. | Different jobs target different repositories. A runner serving multiple projects must resolve the repo per-job. | Resolved from `job.config.repositoryId` (primary) or `GET /workers/repo-config?projectId=X` (fallback). |
| `REPOSITORY_URL` | Passed to `buildInjectedEnv()` via `this.config.repository.url`. Injected as `REPO_URL` env var into the agent container for git clone. | Each job may work on a different repository with a different URL. | Resolved from `job.config.repoUrl` (primary) or `GET /workers/repo-config?projectId=X` (fallback). |
| `REPOSITORY_BRANCH` | Passed via `this.config.repository.branch`. Injected as `REPO_BRANCH`. Defaults to `"main"`. | Already partially dynamic — `config.baseBranch` from the job payload overrides this. But the static default still exists at the runner config level. | Resolved from `job.config.baseBranch` (primary), repo-config endpoint (fallback), or hard default `"main"`. |
| `MCP_URL` | Passed to `buildInjectedEnv()` via `this.config.mcp.url`. Contains a hardcoded `?projectId=<uuid>` query parameter. Used to configure the Almirant MCP server in the agent container. | The `projectId` in the URL must match the project the job belongs to. A static URL locks all jobs to one project. | Constructed dynamically: `{ALMIRANT_API_URL}/mcp?projectId={job.projectId}`. |
| `MCP_API_KEY` | Passed via `this.config.mcp.apiKey`. Used as fallback auth for the MCP server when session tokens are unavailable. | Static key gives every agent container the same credential regardless of project scope. If compromised, it grants access to all MCP operations. | Eliminated entirely. Session tokens (already implemented) become the sole MCP auth mechanism. |
| `ALMIRANT_API_KEY` | Used by the runner process to authenticate against the Almirant API (claiming jobs, heartbeats, fetching GitHub tokens, requesting session tokens). | Currently a human user API key. Must transition to a service account key for proper machine identity. | Becomes a service account key (`alm_sa_` prefix) per A-1112 design. Remains static — it authenticates the runner, not individual jobs. |

### Current Code Flow (job-executor.ts, lines 397-433)

Today, the `JobExecutor` merges the static config with a partial job-level override:

```typescript
// Only repositoryId can be overridden from the job config today
const repositoryOverride =
  typeof jobConfig.repositoryId === "string"
    ? { ...this.config.repository, id: jobConfig.repositoryId }
    : this.config.repository;

const { env, openCodeConfig, resolvedModel } = await buildInjectedEnv({
  workerClient: this.workerClient,
  job,
  repository: repositoryOverride,   // ← mostly static
  mcp: this.config.mcp,             // ← fully static
  model: getRequestedModel(job),
  requestSessionToken: /* ... */,
});
```

The `config-injector.ts` is already designed to accept dynamic values — the issue is that the **caller** (`JobExecutor`) passes static env-derived values.

---

## Per-Job Flow Design

### Step-by-Step Flow

When the runner claims a job, the following resolution steps execute before launching the agent container:

#### Step 1: Claim Job

The runner claims a job via the existing `POST /workers/claim` endpoint. The returned job payload includes:

- `job.organizationId` — the owning organization
- `job.projectId` — the target project
- `job.config.repositoryId` — (optional) explicit repository UUID
- `job.config.repoUrl` — (optional) explicit repository URL
- `job.config.baseBranch` — (optional) branch override

#### Step 2: Resolve Repository Info

The runner resolves the complete repository configuration using a priority chain:

```
Priority 1: Job payload fields (job.config.repositoryId, job.config.repoUrl)
Priority 2: API lookup via GET /workers/repo-config?projectId=X
Priority 3: Static env vars (REPOSITORY_ID, REPOSITORY_URL) — Phase 2 only, removed in Phase 3
```

**Resolution logic (pseudocode):**

```typescript
async function resolveRepository(job: ClaimedJob, staticConfig: StaticRepoConfig): RepoConfig {
  const config = normalizeJobConfig(job);

  // Priority 1: fully specified in job payload
  if (config.repositoryId && config.repoUrl) {
    return {
      id: config.repositoryId,
      url: config.repoUrl,
      branch: config.baseBranch ?? "main",
    };
  }

  // Priority 2: lookup from API using projectId
  const projectId = config.projectId ?? job.projectId;
  if (projectId) {
    try {
      const repoConfig = await workerClient.getRepoConfig(projectId);
      return {
        id: config.repositoryId ?? repoConfig.repositoryId,
        url: config.repoUrl ?? repoConfig.url,
        branch: config.baseBranch ?? repoConfig.branch ?? "main",
      };
    } catch {
      // Fall through to static fallback
    }
  }

  // Priority 3: static env var fallback (Phase 2 only)
  return {
    id: config.repositoryId ?? staticConfig.id,
    url: config.repoUrl ?? staticConfig.url,
    branch: config.baseBranch ?? staticConfig.branch ?? "main",
  };
}
```

#### Step 3: Request Scoped Session Token

The runner calls `POST /workers/session-token` (already implemented) with:

```json
{
  "projectId": "<resolved project ID>",
  "organizationId": "<job.organizationId>",
  "permissions": ["mcp:read", "mcp:write"],
  "ttlSeconds": 7200
}
```

This returns a short-lived JWT (`st_` prefix) scoped to the specific project and organization. This token is the **sole** credential injected into the agent container for MCP access.

#### Step 4: Build Dynamic MCP URL

The MCP URL is constructed from the API base URL and the job's project ID:

```typescript
const mcpUrl = `${ALMIRANT_API_URL}/mcp?projectId=${resolvedProjectId}`;
```

No static `MCP_URL` is needed. See [Dynamic MCP URL Construction](#dynamic-mcp-url-construction) for details.

#### Step 5: Invoke Config Injector

The `buildInjectedEnv()` function receives all dynamic values:

```typescript
const { env, openCodeConfig, resolvedModel } = await buildInjectedEnv({
  workerClient: this.workerClient,
  job,
  repository: resolvedRepo,           // ← dynamic per-job
  mcp: {
    url: dynamicMcpUrl,                // ← dynamic per-job
    apiKey: sessionToken,              // ← scoped session token
  },
  model: getRequestedModel(job),
  requestSessionToken: /* still available as refresh mechanism */,
});
```

The config injector itself requires no changes — it already accepts dynamic values.

---

## Job Payload Enrichment

### Current `AgentJobConfig` Interface

```typescript
interface AgentJobConfig {
  repoPath: string;
  baseBranch: string;
  repoUrl?: string;           // ← exists but often unpopulated
  mcpServerUrl?: string;      // ← exists but often unpopulated
  projectId?: string;         // ← exists but often unpopulated
  repositoryId?: string;      // ← exists but often unpopulated
  // ...
}
```

The fields already exist but are not consistently populated at job creation time.

### Required Changes

#### 1. Populate Fields at Job Creation

The job creation logic (wherever `agent_jobs` rows are inserted) must be updated to resolve and populate:

- `config.repositoryId` — from the project's primary repository (`project_repositories` table, `ORDER BY order ASC LIMIT 1`)
- `config.repoUrl` — from the same repository row
- `config.projectId` — from the job's `projectId` column (already available)
- `config.baseBranch` — from the repository's default branch or fallback to `"main"`

**Repository resolution query:**

```sql
SELECT pr.id, pr.url, pr.provider
FROM project_repositories pr
WHERE pr.project_id = $1
ORDER BY pr."order" ASC
LIMIT 1;
```

This selects the **primary repository** (lowest `order` value) for the project. Projects with multiple repositories will use the primary repo by default; future work can add explicit repo selection to job creation UIs.

#### 2. New Optional Field: `repositoryBranch`

Add an explicit `repositoryBranch` field to `AgentJobConfig` to decouple from the overloaded `baseBranch` (which sometimes means "the branch to work against" vs. "the default branch of the repo"):

```typescript
interface AgentJobConfig {
  // ... existing fields ...
  repositoryBranch?: string;  // NEW: default branch of the target repository
}
```

In practice, `baseBranch` already serves this purpose and is widely used. The new field is an alias for clarity; resolution logic checks `repositoryBranch ?? baseBranch ?? "main"`.

#### 3. Deprecate `mcpServerUrl`

The `mcpServerUrl` field in `AgentJobConfig` becomes unnecessary since the MCP URL is now computed from `ALMIRANT_API_URL` + `projectId`. Mark it as deprecated; existing values are ignored when dynamic construction is active.

---

## New API Endpoint: `GET /workers/repo-config`

### Purpose

Provides a fallback for jobs whose payloads lack repository details. The runner calls this endpoint to resolve the primary repository for a given project.

### Specification

**Route:** `GET /workers/repo-config`

**Authentication:** Worker API key (same as other `/workers/*` endpoints)

**Query Parameters:**

| Parameter   | Type   | Required | Description                    |
|-------------|--------|----------|--------------------------------|
| `projectId` | string | Yes      | UUID of the target project     |

**Response (200):**

```typescript
{
  success: true,
  data: {
    repositoryId: string;       // UUID of the primary repository
    url: string;                // Clone URL (e.g., "https://github.com/org/repo")
    branch: string;             // Default branch (e.g., "main")
    provider: "github" | "gitlab" | "bitbucket";
    githubInstallationId?: string;  // For GitHub App-based token fetching
  }
}
```

**Error Responses:**

| Status | Condition                               |
|--------|-----------------------------------------|
| 400    | Missing `projectId` query parameter     |
| 401    | Invalid or missing API key              |
| 404    | Project not found or has no repositories|

### Implementation Notes

**Repository:**

```typescript
// In project-repository.ts or a new worker-config-repository.ts
export async function getPrimaryRepository(projectId: string) {
  return db.query.projectRepositories.findFirst({
    where: eq(projectRepositories.projectId, projectId),
    orderBy: asc(projectRepositories.order),
  });
}
```

**Route (in worker routes):**

```typescript
.get("/repo-config", async ({ query, set }) => {
  const repo = await getPrimaryRepository(query.projectId);
  if (!repo) {
    set.status = 404;
    return notFoundResponse("No repository configured for this project");
  }
  return successResponse({
    repositoryId: repo.id,
    url: repo.url,
    branch: "main",  // TODO: add defaultBranch column to project_repositories
    provider: repo.provider,
  });
}, {
  query: t.Object({
    projectId: t.String({ format: "uuid" }),
  }),
})
```

### Future Enhancement: `defaultBranch` Column

The `project_repositories` table currently lacks a `defaultBranch` column. The endpoint returns `"main"` as the default. A future migration should add:

```typescript
defaultBranch: varchar("default_branch", { length: 255 }).default("main"),
```

This can be auto-populated by querying the GitHub API when a repository is linked.

---

## Dynamic MCP URL Construction

### Current State

The MCP URL is configured as a static env var:

```
MCP_URL=https://api.almirant.ai/mcp?projectId=<project-uuid>
```

This embeds the `projectId` in the URL, locking all jobs to one project.

### New Construction Logic

The runner builds the MCP URL dynamically for each job:

```typescript
function buildMcpUrl(apiBaseUrl: string, projectId: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return `${base}/mcp?projectId=${encodeURIComponent(projectId)}`;
}
```

**Inputs:**

| Input        | Source                                              |
|--------------|-----------------------------------------------------|
| `apiBaseUrl` | `ALMIRANT_API_URL` env var (the only URL the runner needs) |
| `projectId`  | `job.config.projectId ?? job.projectId`              |

**Authentication:**

The MCP endpoint is authenticated via the scoped session token (from Step 3 of the per-job flow), passed as a `Bearer` token in the `Authorization` header. The static `MCP_API_KEY` is no longer needed.

### Config Injector Impact

The `mcp` parameter to `buildInjectedEnv()` changes from:

```typescript
// Before (static)
mcp: {
  url: env.MCP_URL,        // "https://api.almirant.ai/mcp?projectId=abc123"
  apiKey: env.MCP_API_KEY,  // static long-lived key
}

// After (dynamic per-job)
mcp: {
  url: buildMcpUrl(env.ALMIRANT_API_URL, resolvedProjectId),  // dynamic URL
  apiKey: sessionToken,  // short-lived scoped token
}
```

The `buildInjectedEnv()` function itself requires no changes — it already uses `input.mcp.url` and `input.mcp.apiKey` as-is.

### Session Token as MCP Auth

With dynamic MCP URLs, the `requestSessionToken` callback in `buildInjectedEnv()` becomes the **primary** auth mechanism rather than a fallback enhancement. The flow is:

1. Runner requests session token **before** calling `buildInjectedEnv()`
2. Session token is passed as `mcp.apiKey`
3. Inside `buildInjectedEnv()`, the `requestSessionToken` callback can still be used for **token refresh** during long-running jobs (the existing token refresh interval in `job-executor.ts` already handles this)

---

## Migration Strategy

### Guiding Principles

- **Backwards compatible at each phase** — runners with old `.env` configs continue to work
- **No coordinated deploys** — backend and runner can be updated independently
- **Gradual rollout** — each phase can be validated before proceeding to the next

### Phase 1: Enrich Job Payloads (Backend Change)

**Goal:** Ensure all new jobs have complete repository info in their `config` payload.

**Changes:**

1. Update all job creation paths to populate `config.repositoryId`, `config.repoUrl`, and `config.projectId` by querying `project_repositories`.
2. Add `GET /workers/repo-config` endpoint to the backend.
3. No runner changes needed. Existing runners ignore the additional payload fields.

**Validation:**

- New jobs have `config.repositoryId` and `config.repoUrl` populated.
- `GET /workers/repo-config` returns correct data for projects with repositories.

### Phase 2: Runner Prefers Dynamic Values (Runner Change)

**Goal:** Runner uses job payload values when available, falls back to static env vars.

**Changes:**

1. Update `JobExecutor` to implement the resolution priority chain (Step 2 from the per-job flow).
2. Build MCP URL dynamically when `job.projectId` is available; fall back to static `MCP_URL`.
3. Request session token before `buildInjectedEnv()`; pass as `mcp.apiKey` when available.
4. Static env vars (`REPOSITORY_ID`, `REPOSITORY_URL`, `MCP_URL`, `MCP_API_KEY`) become optional fallbacks.

**Validation:**

- Runner with full static config continues to work (fallback path).
- Runner with only `ALMIRANT_API_URL` and `ALMIRANT_API_KEY` can process jobs with enriched payloads.
- Jobs from Phase 1 work correctly with the updated runner.

**`.env.example` update:**

```env
# --- Core (required) ---
ALMIRANT_API_URL=https://api.almirant.ai
ALMIRANT_API_KEY=alm_sa_<service-account-key>

# --- Repository (optional, overridden by job payload) ---
# REPOSITORY_ID=<deprecated: resolved from job payload>
# REPOSITORY_URL=<deprecated: resolved from job payload>
# REPOSITORY_BRANCH=main

# --- MCP (optional, constructed dynamically from ALMIRANT_API_URL) ---
# MCP_URL=<deprecated: built dynamically per-job>
# MCP_API_KEY=<deprecated: replaced by session tokens>
```

### Phase 3: Remove Static Env Vars (Cleanup)

**Goal:** Remove deprecated static env vars from the runner config schema.

**Prerequisites:**

- All active runners are on Phase 2 code.
- All jobs in the queue have enriched payloads.
- Service accounts (A-1112) are deployed and runners use `alm_sa_` keys.

**Changes:**

1. Remove `REPOSITORY_ID`, `REPOSITORY_URL`, `REPOSITORY_BRANCH`, `MCP_URL`, `MCP_API_KEY` from `config.ts` Zod schema.
2. Remove fallback logic in `JobExecutor` — dynamic resolution is now mandatory.
3. Update `.env.example` to only include `ALMIRANT_API_URL` and `ALMIRANT_API_KEY`.
4. Remove `MCP_API_KEY` from `log-sanitizer.ts` sensitive keys list (session tokens are already ephemeral).

**Validation:**

- Runner starts successfully with only `ALMIRANT_API_URL` and `ALMIRANT_API_KEY` (plus operational vars like `MAX_CONCURRENT`, `DOCKER_SOCKET`, etc.).
- All jobs process correctly using dynamic resolution.

### Timeline

| Phase | Depends On | Estimated Effort |
|-------|-----------|-----------------|
| Phase 1 | None | 1-2 days (backend) |
| Phase 2 | Phase 1 | 1-2 days (runner) |
| Phase 3 | Phase 2 deployed + A-1112 | 0.5 day (cleanup) |

---

## Sequence Diagram

### Per-Job Flow (Phase 2 — Dynamic with Static Fallback)

```
┌─────────┐          ┌──────────────┐          ┌───────────────┐     ┌──────────────┐
│  Runner  │          │ Almirant API │          │ Config        │     │ Agent        │
│ (Worker) │          │   Backend    │          │ Injector      │     │ Container    │
└────┬─────┘          └──────┬───────┘          └──────┬────────┘     └──────┬───────┘
     │                       │                         │                     │
     │  POST /workers/claim  │                         │                     │
     │──────────────────────>│                         │                     │
     │                       │                         │                     │
     │  Job payload          │                         │                     │
     │  { organizationId,    │                         │                     │
     │    projectId,         │                         │                     │
     │    config: {          │                         │                     │
     │      repositoryId?,   │                         │                     │
     │      repoUrl?,        │                         │                     │
     │      baseBranch?,     │                         │                     │
     │      projectId?       │                         │                     │
     │    }                  │                         │                     │
     │<──────────────────────│                         │                     │
     │                       │                         │                     │
     │  ┌──────────────────────────────────┐           │                     │
     │  │ Resolve repository:              │           │                     │
     │  │  1. Check job.config fields      │           │                     │
     │  │  2. If incomplete:               │           │                     │
     │  └──────────────────────────────────┘           │                     │
     │                       │                         │                     │
     │  GET /workers/repo-config                       │                     │
     │    ?projectId=xxx     │                         │                     │
     │──────────────────────>│                         │                     │
     │                       │                         │                     │
     │  { repositoryId, url, │                         │                     │
     │    branch, provider } │                         │                     │
     │<──────────────────────│                         │                     │
     │                       │                         │                     │
     │  ┌──────────────────────────────────┐           │                     │
     │  │ Build dynamic MCP URL:           │           │                     │
     │  │  {API_URL}/mcp?projectId={pid}   │           │                     │
     │  └──────────────────────────────────┘           │                     │
     │                       │                         │                     │
     │  POST /workers/session-token                    │                     │
     │  { projectId, orgId,  │                         │                     │
     │    permissions,       │                         │                     │
     │    ttlSeconds: 7200 } │                         │                     │
     │──────────────────────>│                         │                     │
     │                       │                         │                     │
     │  { token: "st_...",   │                         │                     │
     │    expiresAt: "..." } │                         │                     │
     │<──────────────────────│                         │                     │
     │                       │                         │                     │
     │  buildInjectedEnv({   │                         │                     │
     │    job,               │                         │                     │
     │    repository: {      │                         │                     │
     │      id: resolved,    │                         │                     │
     │      url: resolved,   │                         │                     │
     │      branch: resolved │                         │                     │
     │    },                 │                         │                     │
     │    mcp: {             │                         │                     │
     │      url: dynamic,    │                         │                     │
     │      apiKey: st_token │                         │                     │
     │    }                  │                         │                     │
     │  })                   │                         │                     │
     │────────────────────────────────────>│           │                     │
     │                       │             │           │                     │
     │                       │  getProviderKeys()      │                     │
     │                       │<────────────│           │                     │
     │                       │  keys       │           │                     │
     │                       │────────────>│           │                     │
     │                       │             │           │                     │
     │                       │  getGithubToken(repoId) │                     │
     │                       │<────────────│           │                     │
     │                       │  git token  │           │                     │
     │                       │────────────>│           │                     │
     │                       │             │           │                     │
     │  { env, openCodeConfig}             │           │                     │
     │<────────────────────────────────────│           │                     │
     │                       │                         │                     │
     │  Create container with env vars                 │                     │
     │  ┌──────────────────────────────────────────────────────────┐        │
     │  │ Container env:                                           │        │
     │  │   REPO_URL = resolved repo URL                           │        │
     │  │   REPO_BRANCH = resolved branch                          │        │
     │  │   __GIT_CLONE_TOKEN = github install token               │        │
     │  │   MCP config: { url: dynamic, auth: session token }      │        │
     │  └──────────────────────────────────────────────────────────┘        │
     │─────────────────────────────────────────────────────────────────────>│
     │                       │                         │                     │
     │                       │                         │              Agent executes
     │                       │                         │              with per-job
     │                       │                         │              scoped config
     │                       │                         │                     │
```

### Resolution Priority Chain

```
┌─────────────────────────────────────────────────────────────┐
│                   Repository Resolution                      │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ 1. Job Payload       │──── config.repositoryId present? ──┤
│  │    (highest priority)│     config.repoUrl present?        │
│  └──────────┬───────────┘                                    │
│             │ NO / incomplete                                │
│             ▼                                                │
│  ┌──────────────────────┐                                    │
│  │ 2. API Lookup        │──── GET /workers/repo-config ──────┤
│  │    (fallback)        │     ?projectId=X                   │
│  └──────────┬───────────┘                                    │
│             │ FAILED / no projectId                          │
│             ▼                                                │
│  ┌──────────────────────┐                                    │
│  │ 3. Static Env Vars   │──── REPOSITORY_ID, REPOSITORY_URL │
│  │    (Phase 2 only)    │     (removed in Phase 3)           │
│  └──────────────────────┘                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     MCP URL Resolution                       │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ 1. Dynamic Build     │──── ALMIRANT_API_URL + projectId ──┤
│  │    (highest priority)│     from job payload               │
│  └──────────┬───────────┘                                    │
│             │ NO projectId available                         │
│             ▼                                                │
│  ┌──────────────────────┐                                    │
│  │ 2. Static MCP_URL    │──── env.MCP_URL                    │
│  │    (Phase 2 only)    │     (removed in Phase 3)           │
│  └──────────────────────┘                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     MCP Auth Resolution                       │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ 1. Session Token     │──── POST /workers/session-token ───┤
│  │    (always preferred)│     scoped to project + org        │
│  └──────────┬───────────┘                                    │
│             │ FAILED (non-fatal)                             │
│             ▼                                                │
│  ┌──────────────────────┐                                    │
│  │ 2. Static MCP_API_KEY│──── env.MCP_API_KEY                │
│  │    (Phase 2 only)    │     (removed in Phase 3)           │
│  └──────────────────────┘                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
