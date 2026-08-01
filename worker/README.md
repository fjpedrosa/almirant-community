# Almirant Worker

The Almirant Worker is a Bun/TypeScript daemon that polls for AI jobs and executes Claude Code (or Codex) against your repositories. When a work item is queued for AI execution, the worker claims the job, creates a git worktree (or clones the repository), runs the AI provider against the codebase, commits the changes, pushes a branch, and opens a GitHub Pull Request automatically.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Configuration Reference](#configuration-reference)
- [Validate Configuration](#validate-configuration)
- [Running Locally](#running-locally)
- [Production Deployment (VPS)](#production-deployment-vps)
- [Private Repository Access](#private-repository-access)
- [Troubleshooting](#troubleshooting)

---

## Overview

```
User creates work item (title + description)
        |
        v
POST /api/agent-jobs  (or "Run with AI" button in Almirant)
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
Work item in Almirant updated with PR link
```

The worker is stateless between jobs. Multiple workers can run against the same Almirant backend — each claims jobs independently.

---

## Prerequisites

### For local development

| Requirement | Version | Notes |
|-------------|---------|-------|
| [Bun](https://bun.sh) | >= 1.1 | Runtime and package manager |
| git | >= 2.x | Must be in PATH |
| Claude Code CLI | 2.1.209 | `npm install -g @anthropic-ai/claude-code@2.1.209` |
| Almirant backend | running | Port 3001 by default |
| Anthropic API key | - | For Claude Code provider |

### For production (Docker)

| Requirement | Notes |
|-------------|-------|
| Docker + Docker Compose | Builds and runs the worker container |
| VPS with SSH access | For `scripts/deploy.sh` |
| `git` on host | For pulling latest code |

Claude Code CLI is installed automatically inside the Docker image — you do not need it on the host for production.

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/almirant.git
cd almirant
```

### 2. Install dependencies

From the `worker/` directory:

```bash
cd worker
bun install
```

### 3. Configure mc-worker.json

Copy the example and edit it:

```bash
cp worker/mc-worker.json.example worker/mc-worker.json
```

Open `worker/mc-worker.json` and fill in your values:

```json
{
  "apiUrl": "http://localhost:3001",
  "apiKey": "your-worker-api-key-from-almirant-settings",
  "maxConcurrentAgents": 2,
  "providers": ["claude-code"],
  "projects": [
    {
      "projectId": "YOUR-PROJECT-UUID",
      "repoPath": "/absolute/path/to/your/local/repo",
      "baseBranch": "main"
    }
  ]
}
```

**How to find your project UUID**: Open Almirant in the browser, navigate to the project, and copy the UUID from the URL.

**How to get a worker API key**:

1. Open Almirant at <http://localhost:3000>
2. Go to Settings > API Keys
3. Create a new key
4. Copy the key value into `mc-worker.json` under `apiKey`

### 4. Set up environment variables

Copy the example env file:

```bash
cp worker/.env.example worker/.env
```

Open `worker/.env` and set at minimum:

```bash
# Required: Almirant backend
MC_API_URL=http://localhost:3001
MC_API_KEY=your-worker-api-key-from-almirant-settings

# Required: AI provider
ANTHROPIC_API_KEY=sk-ant-...

# Required for PR creation
GITHUB_TOKEN=ghp_...   # PAT with repo and pull_requests scopes
```

### 5. Ensure the Almirant backend is running

The worker requires a running Almirant backend. From the project root:

```bash
bun run docker:up      # Start PostgreSQL
bun run dev:api        # Start backend on port 3001
```

---

## Configuration Reference

Configuration is loaded from two sources, merged in this order (env vars take precedence over the file):

1. `mc-worker.json` — looked up first in the current working directory, then in `~/mc-worker.json`
2. Environment variables (including `worker/.env`, loaded automatically via dotenv)

### mc-worker.json fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiUrl` | string | Yes | - | Base URL of the Almirant backend (e.g. `http://localhost:3001`) |
| `apiKey` | string | Yes | - | Worker API key from Almirant Settings > API Keys |
| `workerId` | string | No | auto-generated | Stable identifier for this worker instance. Auto-generated as `<hostname>-<random>` if not set |
| `maxConcurrentAgents` | number | No | `2` | Maximum number of AI jobs to run simultaneously |
| `providers` | string[] | No | `["claude-code"]` | Enabled AI providers. Valid values: `"claude-code"`, `"codex"` |
| `projects` | array | No | `[]` | List of project configurations (see below) |

### projects[] fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | Yes | UUID of the Almirant project |
| `repoPath` | string | Yes | Absolute path to the local repository clone |
| `baseBranch` | string | Yes | Base branch for worktrees and PRs (e.g. `main`) |
| `repoUrl` | string | No | HTTPS clone URL. If set, the worker clones on demand to a temp directory |
| `additionalRepos` | array | No | Extra repositories needed by the project (e.g. monorepo sub-packages) |

### Environment variables

All env vars override their mc-worker.json counterparts.

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `MC_API_URL` | `apiUrl` | Almirant backend base URL |
| `MC_API_KEY` | `apiKey` | Worker API key |
| `MC_WORKER_ID` | `workerId` | Worker instance identifier |
| `MC_MAX_CONCURRENT` | `maxConcurrentAgents` | Max parallel jobs (must be a positive integer) |
| `MC_POLL_INTERVAL_MS` | - | Job poll interval in milliseconds (default: `5000`) |
| `ANTHROPIC_API_KEY` | - | API key for Claude Code provider |
| `OPENAI_API_KEY` | - | API key for Codex provider |
| `REDIS_URL` | - | If set, switches queue adapter to BullMQ (see note below) |
| `WORKER_REPO_BASE_PATH` | - | Root directory for repository checkouts (default: `~/mc-worker-repos`) |
| `DATABASE_URL` | - | Required only for `mc-worker run <taskId>` (direct DB access) |
| `GITHUB_TOKEN` | - | GitHub PAT for PR creation (also accepted as `GH_TOKEN` or `GITHUB_API_TOKEN`) |

### Queue adapter selection

The worker supports two queue backends:

- **PostgreSQL adapter (default)**: Polls the Almirant backend API. No extra infrastructure required. Use this for local development.
- **BullMQ adapter**: Uses Redis for job queuing. Higher throughput. Used automatically in production when `REDIS_URL` is set.

**Important**: Do not set `REDIS_URL` for local development unless you have Redis running locally. Leave it commented out in `worker/.env`.

---

## Validate Configuration

Before starting the daemon, run the built-in validation to catch misconfigurations:

```bash
cd worker
bun run src/index.ts validate
```

The validator runs these checks:

| Check | What it tests |
|-------|--------------|
| `MC_API_URL` / `MC_API_KEY` | Config loads without errors |
| API connectivity | `GET {apiUrl}/health` responds 200 |
| git | `git --version` works |
| Repo base path | `WORKER_REPO_BASE_PATH` (or `~/mc-worker-repos`) exists and is writable |
| Disk space | At least 5 GB available (warns if lower) |
| Provider API keys | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` present locally, or retrievable from the backend DB |

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

A `[FAIL]` on any check must be resolved before running the daemon. A `[WARN]` on provider keys is acceptable only if the key is stored in the Almirant backend (Settings > Provider Keys).

---

## Running Locally

### Start the daemon

The daemon polls for jobs continuously and processes them as they arrive:

```bash
cd worker
bun run src/index.ts daemon
```

Expected startup output:

```
mc-worker queue: using PG adapter (default)
mc-worker daemon started
```

If you see `using BullMQ adapter (REDIS_URL set)`, unset `REDIS_URL` from your environment and restart.

The daemon runs until interrupted. Use `Ctrl+C` to stop.

### Run a single job (for testing)

The `run` command claims and executes a specific job immediately in the current process, bypassing the poll cycle. This is useful for testing and debugging.

```bash
cd worker
bun run src/index.ts run MC-123
```

The task ID format is `MC-NNN` where `NNN` is the numeric ID shown in the Almirant UI.

Note: `mc-worker run` accesses the database directly and requires `DATABASE_URL` to be set in `worker/.env`.

### Available commands

```bash
# Start continuous daemon
bun run src/index.ts daemon

# Validate configuration
bun run src/index.ts validate

# Execute a single job immediately
bun run src/index.ts run MC-123

# Show help
bun run src/index.ts --help
```

---

## Production Deployment (VPS)

Production uses Docker Compose to run the backend, worker, and Redis together on a VPS.

### Files involved

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Defines `backend`, `worker`, and `redis` services |
| `worker/Dockerfile` | Builds the worker image (Bun + Claude Code CLI) |
| `worker/.env.production` | Worker env vars for production |
| `backend/api/.env.production` | Backend env vars for production |
| `scripts/deploy.sh` | Automated deployment script |

### Step 1: Prepare production env files

On the VPS, create the production env files from the examples:

```bash
cp worker/.env.example worker/.env.production
```

Edit `worker/.env.production` and set these required values:

```bash
# Required: API connection (internal Docker network name)
MC_API_URL=http://backend:3001    # Service name from docker-compose.prod.yml
MC_API_KEY=your-worker-api-key

# Required: AI provider
ANTHROPIC_API_KEY=sk-ant-...

# Required: GitHub PR creation
GITHUB_TOKEN=ghp_...

# Production queue (BullMQ via Redis)
REDIS_URL=redis://redis:6379     # Service name from docker-compose.prod.yml

# Optional tuning
MC_MAX_CONCURRENT=4
```

Note: In production, `MC_API_URL` and `REDIS_URL` use Docker internal service names (`backend` and `redis`), not `localhost`.

Edit `backend/api/.env.production` with the backend's required values (see `backend/api/.env.example` for the full list).

### Step 2: Deploy with the deploy script

```bash
# Deploy all services (backend + worker + redis)
./scripts/deploy.sh

# Deploy only the worker
./scripts/deploy.sh worker

# Deploy only the backend
./scripts/deploy.sh backend

# Rollback to a previous commit
./scripts/deploy.sh --rollback
```

The script performs these steps automatically:

1. Verifies prerequisites (Docker, env files)
2. Pulls latest code from `origin/main`
3. Builds Docker images
4. Starts services with `docker compose up -d --build`
5. Waits for health checks to pass
6. Verifies the backend `/health` endpoint

### Step 3: Verify services are running

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output:

```
NAME               STATUS          PORTS
almirant-backend   Up (healthy)    0.0.0.0:3001->3001/tcp
almirant-redis     Up (healthy)
almirant-worker    Up (healthy)
```

### Common production operations

```bash
# View logs for all services
docker compose -f docker-compose.prod.yml logs -f

# View worker logs only
docker compose -f docker-compose.prod.yml logs -f worker

# Restart a single service
docker compose -f docker-compose.prod.yml restart worker

# Stop all services
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (destructive — deletes repo checkouts)
docker compose -f docker-compose.prod.yml down -v
```

---

## Private Repository Access

When the repositories configured in `mc-worker.json` are private, the worker needs credentials to clone them.

### Option A: GITHUB_TOKEN (simplest)

Set a GitHub Personal Access Token with `repo` and `pull_requests` scopes:

```bash
GITHUB_TOKEN=ghp_...
```

The worker and Claude Code CLI both pick this up automatically. This is sufficient for most setups.

### Option B: GitHub App (recommended for organizations)

If the Almirant backend is configured with a GitHub App, the worker fetches short-lived installation tokens automatically. No `GITHUB_TOKEN` env var is needed on the worker.

For this to work, the backend must have these env vars configured in `backend/api/.env.production`:

```bash
GITHUB_APP_ID=your-app-id
GITHUB_PRIVATE_KEY="<github-app-private-key-pem>"
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

The GitHub App must be installed on the target organization or repository, and it needs `Contents` (read/write) and `Pull requests` (write) permissions.

---

## Troubleshooting

### Queue adapter issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `using BullMQ adapter (REDIS_URL set)` on local dev | `REDIS_URL` is set in environment | Remove or comment out `REDIS_URL` from `worker/.env` and restart |
| Jobs stuck in `queued` status on production | Redis not reachable | Check `REDIS_URL` and Redis container health: `docker compose logs redis` |

### Authentication issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unauthorized (401)` on job claim | `MC_API_KEY` is wrong or expired | Regenerate the key in Almirant Settings > API Keys |
| `403` or missing permissions on PR creation | `GITHUB_TOKEN` lacks scopes | Create a new PAT with `repo` and `pull_requests` scopes |

### AI provider issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[FAIL] Provider API keys: no provider API keys set` | `ANTHROPIC_API_KEY` missing | Set it in `worker/.env` or add it in Almirant Settings > Provider Keys |
| `claude: command not found` | Claude Code CLI not installed | Run `npm install -g @anthropic-ai/claude-code@2.1.209` (only for local dev; Docker handles this automatically) |
| PR created but no changes in diff | Claude Code ran but made no edits | Refine the work item description to be more specific and actionable |

### Repository and git issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Clone failed with exit code 128 | Private repo with missing credentials | Verify `repoUrl` in `mc-worker.json` and that `GITHUB_TOKEN` has access |
| `no project config for work item projectId=...` | Project not listed in `mc-worker.json` | Add the project entry with the matching `projectId` |
| `bun install failed in clone` | Dependencies fail in the cloned repo | Check that the repo has a valid `package.json`; ensure `bun` is in PATH |
| `[FAIL] Repo base path: does not exist or is not writable` | `WORKER_REPO_BASE_PATH` dir missing | Create the directory: `mkdir -p ~/mc-worker-repos` |

### Configuration issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Invalid config file mc-worker.json` | Schema validation failure | Run `bun run src/index.ts validate` and read the field error messages |
| `work item not found for taskId MC-NNN` | Wrong task ID or wrong database | Verify the task exists in the Almirant board; check `DATABASE_URL` for direct run |
| `Invalid job config: repoPath: Required` | Job created without a `repoPath` | Ensure the project entry in `mc-worker.json` has the correct `projectId` and `repoPath` |

### Disk space

Each job creates a git worktree or temporary clone. Clones can be several hundred MB for large repositories. Ensure at least 5 GB free on the worker host.

In production, the `worker_repos` volume stores persistent checkouts. To reclaim space:

```bash
docker compose -f docker-compose.prod.yml down -v
# Warning: this removes all worker repo data; the worker will re-clone on next job
```
