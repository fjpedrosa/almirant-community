# Worker End-to-End Test Guide

This guide walks through testing the complete worker flow: from enqueuing a job to seeing a GitHub PR created automatically.

## Prerequisites

Before starting, ensure all of the following are true:

- [ ] Docker is running and PostgreSQL is up: `bun run docker:up` (from project root)
- [ ] Backend is running: `bun run dev:api` (port 3001, from project root)
- [ ] `worker/mc-worker.json` is configured with your project (see `worker/mc-worker.json.example`)
- [ ] `ANTHROPIC_API_KEY` is set in the environment or stored in the backend DB via Settings > Provider Keys
- [ ] `GITHUB_TOKEN` is set in the environment with `repo` and `pull_requests` permissions (GitHub PAT)
- [ ] Worker connectivity verified: `cd worker && bun run src/index.ts validate`

### Required Environment Variables

The worker reads config from `mc-worker.json` and environment variables. Create a `.env` file in the `worker/` directory or export the variables directly:

```bash
# Required: Almirant backend
MC_API_URL=http://localhost:3001
MC_API_KEY=your-worker-api-key-from-almirant-settings

# Required: AI provider (Claude Code)
ANTHROPIC_API_KEY=sk-ant-...

# Required: GitHub PR creation
GITHUB_TOKEN=ghp_...       # PAT with repo + pull_requests scopes
# OR
GH_TOKEN=ghp_...           # alternative name accepted by gh CLI

# Optional: concurrency (default: 2)
MC_MAX_CONCURRENT=1

# DO NOT set REDIS_URL here — the worker must use the PG queue adapter
```

### mc-worker.json Configuration

Copy `worker/mc-worker.json.example` to `worker/mc-worker.json` and fill in the real values:

```json
{
  "apiUrl": "http://localhost:3001",
  "apiKey": "your-worker-api-key-from-almirant-settings",
  "maxConcurrentAgents": 1,
  "providers": ["claude-code"],
  "projects": [
    {
      "projectId": "YOUR-PROJECT-UUID",
      "repoPath": "/absolute/path/to/your/repo",
      "baseBranch": "main"
    }
  ]
}
```

To find your project UUID: open Almirant in the browser, navigate to the project, and copy the UUID from the URL path. Alternatively, run `bun run src/index.ts validate` — it will surface config errors before you start.

### Get a Worker API Key

1. Open Almirant at <http://localhost:3000>
2. Go to Settings > API Keys
3. Create a new key with worker permissions
4. Copy the key into `mc-worker.json` under `apiKey`

---

## Step 1: Validate Worker Configuration

Before starting the daemon, confirm all checks pass:

```bash
cd /path/to/almirant/worker
bun run src/index.ts validate
```

All entries should show `[PASS]`. Warnings on provider keys are acceptable only if the API key is stored in the backend DB (Settings > Provider Keys). A `[FAIL]` on any entry must be fixed before proceeding.

Expected output when everything is correct:

```
Worker Configuration Validation

  [PASS] MC_API_URL: http://localhost:3001
  [PASS] MC_API_KEY: configured
  [PASS] API connectivity: http://localhost:3001/health responded 200
  [PASS] git: git version 2.x.x
  [PASS] Repo base path: /Users/you/mc-worker-repos exists and is writable
  [PASS] Disk space: 50GB available
  [PASS] Provider API keys: configured: Anthropic

All checks passed.
```

---

## Step 2: Start the Worker Daemon

```bash
cd /path/to/almirant/worker
bun run src/index.ts daemon
```

Expected startup log lines (look for these specifically):

```
mc-worker queue: using PG adapter (default)      # confirms no BullMQ/Redis
mc-worker daemon started                          # worker is polling
```

If you see `using BullMQ adapter (REDIS_URL set)` instead, remove `REDIS_URL` from the environment and restart. The PG adapter polls the backend directly; BullMQ requires a running Redis instance.

Keep this terminal open and visible so you can watch logs during the test.

---

## Step 3: Create a Test Work Item

Use a minimal, reversible change that Claude Code can complete reliably in one pass. A documentation-only change to `README.md` is ideal: no tests to run, no build step, no risk of breaking the codebase.

### Option A - Via Almirant Frontend (Recommended)

1. Open <http://localhost:3000>
2. Navigate to your project board (the same project whose `projectId` is in `mc-worker.json`)
3. Create a new Task with:
   - **Title**: `Worker E2E test: add comment to README`
   - **Description**:

     ```
     Add a single line to the very end of README.md with the following content:
     <!-- worker-e2e-test: verified -->
     Do not modify any other file.
     ```

4. Note the task ID shown in the UI (format: `MC-NNN`)

### Option B - Via Backend API

First, get your session token from the browser DevTools (Application > Cookies > `better-auth.session_token`), then:

```bash
# Replace BOARD_ID, COLUMN_ID with real UUIDs from your board
AUTH_HEADER="Authorization: Bearer ${SESSION_TOKEN}"
curl -X POST http://localhost:3001/api/work-items \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "boardId": "BOARD_UUID",
    "boardColumnId": "TODO_COLUMN_UUID",
    "title": "Worker E2E test: add comment to README",
    "description": "Add a single line to the very end of README.md with the content: <!-- worker-e2e-test: verified -->. Do not modify any other file.",
    "type": "task"
  }'
```

The response includes `data.taskId` (e.g. `"MC-42"`) and `data.id` (the UUID). Note both.

---

## Step 4: Queue the Job

### Option A - "Run with AI" Button (Recommended for UI Testing)

1. Open the work item detail panel in Almirant
2. Click the **Run with AI** button
3. The job is enqueued immediately; the button state changes to reflect the queued status

### Option B - Via API

```bash
AUTH_HEADER="Authorization: Bearer ${SESSION_TOKEN}"
curl -X POST http://localhost:3001/api/agent-jobs \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "workItemId": "WORK_ITEM_UUID",
    "provider": "claude-code",
    "priority": "high"
  }'
```

A `201` response confirms the job was created in the queue.

### Option C - Run Directly by Task ID (Fastest, Bypasses Queue Polling)

The `run` command creates the job and executes it immediately in the current process, without waiting for the daemon poll cycle. It requires direct database access via `DATABASE_URL`.

```bash
# From the worker directory; requires DATABASE_URL set (direct DB access)
bun run src/index.ts run MC-42
```

Progress is printed inline:

```
[job-uuid][starting] Starting job pipeline
[job-uuid][reading] Creating worktree: mc-42-worker-e2e-test-add-comment-to-readme
[job-uuid][implementing] Executing provider: claude-code
[job-uuid][implementing] Claude is working...
[job-uuid][testing] Committing changes
[job-uuid][testing] Pushing branch: mc-42-worker-e2e-test-add-comment-to-readme
[job-uuid][testing] Creating PR
```

---

## Step 5: Monitor Worker Logs (Daemon Mode)

When using the daemon (Options A or B in Step 4), watch the terminal where the daemon is running for these key phases:

| Log message | Meaning |
|-------------|---------|
| `[claiming jobs] Found 1 job(s)` | Worker picked up the job from the queue |
| `[job-id][reading] Creating worktree: mc-NNN-...` | Worktree created from base branch |
| `[job-id][reading] Cloning repository: https://...` | Clone-on-demand flow (if `repoUrl` is set) |
| `[job-id][reading] Installing dependencies (bun install)` | Dependencies installed in clone |
| `[job-id][implementing] Executing provider: claude-code` | Claude Code is starting |
| `[job-id][implementing] Claude is working...` | Claude Code is running (may take 1-5 minutes) |
| `[job-id][testing] Committing changes` | Changes committed to branch |
| `[job-id][testing] Pushing branch: mc-NNN-...` | Branch pushed to remote |
| `[job-id][testing] Creating PR` | PR being created via GitHub API |
| `mc-worker job completed` | Job finished; `prUrl` is in the log |

The full cycle typically takes 2-10 minutes depending on repo size and Claude Code execution time.

---

## Step 6: Verify Results

Work through this checklist to confirm the full flow completed correctly:

- [ ] **GitHub PR created**: A PR appears in your GitHub repository (check the `prUrl` in the worker completion log or in Almirant's work item detail panel)
- [ ] **PR branch is correct**: The branch name matches the pattern `mc-NNN-<slug>` derived from the task ID and title
- [ ] **PR targets the right base branch**: The PR base branch matches `baseBranch` from `mc-worker.json`
- [ ] **Commit contains the right change**: The PR diff shows only the README change requested in the work item description
- [ ] **Work item updated in Almirant**: The work item shows the PR link and its status reflects completion
- [ ] **No error logs in worker output**: The daemon terminal shows no `error` or `permanently` entries for this job
- [ ] **Branch cleaned up**: The worktree directory (local mode) or temp clone directory is removed after the job completes

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `using BullMQ adapter (REDIS_URL set)` in startup | `REDIS_URL` is set in environment | Unset `REDIS_URL` and restart the worker |
| `Unauthorized (401)` on job claim | `MC_API_KEY` is wrong or expired | Regenerate the API key in Settings > API Keys |
| `[FAIL] Provider API keys: no provider API keys set` | `ANTHROPIC_API_KEY` missing | Set it in the environment or add it in Settings > Provider Keys |
| `Missing GitHub token` or 403 on PR creation | `GITHUB_TOKEN` not set or lacks permissions | Add `GITHUB_TOKEN` with `repo` and `pull_requests` scopes |
| Clone failed with 128 or repository not found | Private repo, wrong URL, or missing token | Verify `repoUrl` in `mc-worker.json` and that `GITHUB_TOKEN` has access |
| `claude: command not found` | Claude Code CLI not installed | Install globally: `npm install -g @anthropic-ai/claude-code@2.1.209` |
| `bun install failed in clone` | Dependencies fail in the cloned repo | Check that the repo has a valid `package.json` and `bun` is in PATH |
| Job stuck in `queued` status | Daemon not running or poll interval too long | Start the daemon; default poll interval is 5000ms |
| `work item not found for taskId MC-NNN` | Wrong task ID or wrong database | Verify the task ID exists in the Almirant board; check `DATABASE_URL` |
| `no project config for work item projectId=...` | `mc-worker.json` projects array missing this project | Add the project entry with matching `projectId` to `mc-worker.json` |
| `Invalid job config: repoPath: Required` | Job created without a `repoPath` in config | Use the `run` command (reads config from `mc-worker.json`) or pass config in the API request body |
| PR created but no changes in diff | Claude Code ran but made no file edits | Refine the work item description to be more specific |

### Checking Job Status via API

```bash
# List recent jobs
AUTH_HEADER="Authorization: Bearer ${SESSION_TOKEN}"
curl http://localhost:3001/api/agent-jobs \
  -H "$AUTH_HEADER"

# Get a specific job's status and result
curl http://localhost:3001/api/agent-jobs/JOB_UUID \
  -H "$AUTH_HEADER"
```

A completed job has `status: "completed"` and a `result` field containing `prUrl`, `commitSha`, `filesChanged`, `linesAdded`, and `linesRemoved`.

---

## E2E Flow Diagram

```
User creates work item (title + description)
        |
        v
POST /api/agent-jobs  (or "Run with AI" button)
        |
        v
agentJobs table: status = queued
        |
        v
Worker daemon polls /workers/jobs/claim every 5s
        |
        v
Job claimed -> orchestrator.processJob()
        |
        +-- Dependency check (reschedule if blocked)
        |
        +-- Quota check (postpone if exceeded)
        |
        v
Read work item via /workers/work-items/:id
        |
        v
Create git worktree (or clone repo to temp dir)
        |
        v
Claude Code runs against codebase with work item as prompt
        |
        v
Changes committed to branch mc-NNN-<slug>
        |
        v
Branch pushed to GitHub remote
        |
        v
POST /api/github/pull-requests -> GitHub API creates PR
        |
        v
POST /workers/jobs/:id/status -> status: completed + prUrl
        |
        v
Work item in Almirant updated with PR link
```

---

## Quick Reference: Worker Commands

```bash
# From the worker/ directory:

# Validate config before starting
bun run src/index.ts validate

# Start continuous daemon (polls every 5s)
bun run src/index.ts daemon

# Execute a single task immediately (needs DATABASE_URL)
bun run src/index.ts run MC-123

# Show help
bun run src/index.ts --help

# Show version
bun run src/index.ts --version
```
