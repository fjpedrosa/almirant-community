# E2E Test Procedure: Discord -> Runner -> OpenCode -> Discord

## Overview

This document describes the end-to-end test procedure for the remote agent execution
platform. The full pipeline is:

```
Discord slash command
  -> Backend API (discord-interactions.routes.ts)
  -> PostgreSQL agent_jobs table (status: queued)
  -> Runner claims job (status: running)
  -> Runner creates Docker container (OpenCode)
  -> OpenCode executes task in container
  -> Output streamed to Discord via bidirectional relay + BullMQ queue
  -> Runner reports completion (status: completed)
  -> Discord thread renamed/archived
```

---

## 1. Services required

| Service | Port | Command | Notes |
|---------|------|---------|-------|
| PostgreSQL | 5432 | `bun run docker:up` (from repo root) | Database |
| Backend API | 3001 | `bun run dev:api` (from repo root) | Elysia server |
| Runner | 3002 | `cd services/runner && bun run dev` | Needs Docker socket |
| Discord Bridge | 3003 | `cd services/discord-bridge && bun run dev` | Needs Redis |
| Redis | 6379 | `docker run -d -p 6379:6379 redis:7-alpine` | For BullMQ queue |

### Environment files

**Backend API** (`backend/api/.env`):

- `DATABASE_URL` -- PostgreSQL connection string
- `DISCORD_PUBLIC_KEY` -- Discord application public key
- `DISCORD_APPLICATION_ID` -- Discord application ID
- `DISCORD_BOT_TOKEN` -- Discord bot token
- `ENCRYPTION_KEY` -- For decrypting provider keys

**Runner** (`services/runner/.env`):

- `ALMIRANT_API_URL` -- Backend API URL (e.g. `http://localhost:3001`)
- `ALMIRANT_API_KEY` -- Worker API key (from `api_keys` table)
- `DOCKER_SOCKET` -- Docker socket path (`/var/run/docker.sock`)
- `OPENCODE_IMAGE` -- Docker image for OpenCode
- `DISCORD_BOT_TOKEN` -- Same bot token as backend
- `DISCORD_CHANNEL_ID` -- Discord channel for thread creation
- `REPOSITORY_URL` -- Git repository URL
- `REPOSITORY_ID` -- Repository UUID in database

**Discord Bridge** (`services/discord-bridge/.env`):

- `REDIS_URL` -- Redis connection URL
- `DISCORD_BOT_TOKEN` -- Same bot token
- `DISCORD_CHANNEL_ID` -- Same channel ID

---

## 2. Pre-flight checks

### 2.1 Verify database has required data

```bash
# Check backend is reachable
curl -fsS http://localhost:3001/health

# Check the worker can authenticate
curl -fsS http://localhost:3001/workers/provider-keys \
  -H "Authorization: Bearer <ALMIRANT_API_KEY>"
```

### 2.2 Verify runner health

```bash
curl -fsS http://localhost:3002/health
# Expected: { "ok": true, "docker": true, "runner": { "isRunning": true, ... } }
```

### 2.3 Verify Docker is running

```bash
docker ps
# Should list running containers (at minimum PostgreSQL)
```

### 2.4 Verify Discord bot is configured

- Bot must be in the target Discord server
- Bot needs permissions: Send Messages, Create Public Threads, Manage Threads,
  Read Message History, Add Reactions, Use Slash Commands
- Slash commands must be registered (see `scripts/` for registration scripts)

---

## 3. Create a test job manually

### Option A: Via Discord slash command

```
/implement work_item_id:A-T-42
```

This is the primary flow. The backend:

1. Looks up the work item by task_id
2. Creates an agent job in `queued` status
3. Creates a Discord thread
4. Posts a follow-up with job ID

### Option B: Via API (bypassing Discord)

```bash
# Get a valid session token from the frontend (browser dev tools)
TOKEN="<session-token>"

# Create an implementation job
curl -X POST http://localhost:3001/api/agent-jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workItemId": "<work-item-uuid>",
    "provider": "codex",
    "priority": "medium",
    "jobType": "implementation",
    "config": {
      "repoPath": ".",
      "baseBranch": "main"
    }
  }'
```

### Option C: Via Worker API (for smoke testing runner only)

```bash
# This bypasses auth and directly tests the worker claim flow.
# First, insert a job directly (requires DB access or seed script).
# Then verify the runner picks it up via /status endpoint.
curl -fsS http://localhost:3002/status
```

---

## 4. Verification at each stage

### Stage 1: Job creation (queued)

**Check**:

```bash
curl http://localhost:3001/api/agent-jobs/<job-id> \
  -H "Authorization: Bearer $TOKEN"
```

**Expect**:

- `status: "queued"`
- `workItemId` set
- `config` contains `repoPath`, `baseBranch`

### Stage 2: Runner claims job (running)

**Check**: Runner logs should show:

```
runner claim: claimed 1 job(s)
```

**Check API**:

```bash
curl http://localhost:3001/api/agent-jobs/<job-id> \
  -H "Authorization: Bearer $TOKEN"
```

**Expect**:

- `status: "running"`
- `workerId` set
- `startedAt` set

### Stage 3: Container created

**Check**: Docker should show a new container:

```bash
docker ps --filter "label=almirant-runner=true"
```

**Expect**:

- Container with label `job-id=<job-id>`
- Container with label `worker-id=<worker-id>`
- Image matches configured OpenCode image

### Stage 4: Output streaming

**Check Discord thread**:

- Thread created with name related to the work item
- Session control buttons (Stop / Shutdown) appear
- Progress messages appear as OpenCode works

**Check BullMQ** (if redis-cli available):

```bash
redis-cli LLEN bull:discord-output:wait
```

### Stage 5: Interactions (if questions arise)

**Check Discord thread**:

- Question appears with button options or free-text prompt
- Clicking a button sends the answer
- Job transitions back to `running` after answer

**Check API**:

```bash
curl http://localhost:3001/api/agent-jobs/<job-id>/interactions \
  -H "Authorization: Bearer $TOKEN"
```

### Stage 6: Completion

**Check API**:

```bash
curl http://localhost:3001/api/agent-jobs/<job-id> \
  -H "Authorization: Bearer $TOKEN"
```

**Expect**:

- `status: "completed"` or `"failed"`
- `completedAt` or `failedAt` set
- `result` contains execution metadata
- `durationMs` set
- If completed: `prUrl`, `branchName`, `commitSha` may be populated

**Check Docker**:

```bash
docker ps --filter "label=job-id=<job-id>"
# Should return empty -- container removed after completion
```

**Check Discord thread**:

- Completion message posted
- Thread renamed to reflect outcome
- Session control buttons disabled

---

## 5. Common failure modes and debugging

### Runner does not claim jobs

**Symptoms**: Job stays in `queued` forever.

**Debug**:

1. Check runner is running: `curl http://localhost:3002/health`
2. Check API key is valid: runner logs show 401 errors if key is wrong
3. Check `ALMIRANT_API_URL` in runner .env points to the correct backend
4. Check runner heartbeat: backend should show the worker in DB
5. Check claim interval: default is 10s, verify with runner logs

### Container fails to start

**Symptoms**: Job transitions to `failed` immediately.

**Debug**:

1. Check Docker socket access: runner needs `/var/run/docker.sock`
2. Check image exists: `docker images | grep opencode`
3. Check runner logs for Docker API errors
4. Try manually: `docker run --rm <image> echo test`
5. Check tmpfs/volume configuration in `job-executor.ts`

### Discord messages not appearing

**Symptoms**: Job runs but Discord thread is empty.

**Debug**:

1. Check `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` in runner .env
2. Check bot has permissions in the Discord channel
3. Check runner logs for Discord API errors (403, 429)
4. Check discord-bridge is running and consuming from Redis
5. Check Redis connectivity: `redis-cli ping`

### Provider key errors

**Symptoms**: Container starts but agent fails with auth errors.

**Debug**:

1. Check AI provider keys are configured in Almirant UI
2. Check `ENCRYPTION_KEY` is set in backend .env
3. Test key resolution:

   ```bash
   curl http://localhost:3001/workers/provider-keys?jobId=<job-id> \
     -H "Authorization: Bearer <WORKER_API_KEY>"
   ```

4. Check connection has `isActive: true` in database

### GitHub clone failures

**Symptoms**: Container starts but fails on git clone.

**Debug**:

1. Check `REPOSITORY_URL` and `REPOSITORY_ID` in runner .env
2. Check GitHub App installation exists in database
3. Test token generation:

   ```bash
   curl "http://localhost:3001/workers/github/installation-token?repositoryId=<repo-id>" \
     -H "Authorization: Bearer <WORKER_API_KEY>"
   ```

4. Check GitHub App has repository access

### Interaction timeout

**Symptoms**: Job fails with timeout error during `waiting_for_input`.

**Debug**:

1. Default timeout is 10 minutes (configurable via `JOB_INTERACTION_TIMEOUT_MS`)
2. Check the interaction status:

   ```bash
   curl http://localhost:3001/api/agent-jobs/<job-id>/interactions \
     -H "Authorization: Bearer $TOKEN"
   ```

3. If `status: "timed_out"`, the user did not respond in time
4. Check `timeoutAction` -- default is "fail" which fails the whole job

### WebSocket events not received (frontend)

**Symptoms**: Frontend does not update in real time.

**Debug**:

1. Check WebSocket connection in browser dev tools (Network -> WS)
2. Check backend logs for WebSocket broadcast errors
3. Verify `organizationId` is correctly resolved for the job
4. Check `wsConnectionManager` is initialized in the backend

---

## 6. Monitoring endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /health` (runner:3002) | GET | None | Runner + Docker health |
| `GET /status` (runner:3002) | GET | None | Runner snapshot (active jobs, uptime) |
| `GET /workers/jobs/running` | GET | Worker API key | All running jobs |
| `GET /api/agent-jobs?status=running` | GET | Session token | Running jobs (user-facing) |
| `GET /api/agent-jobs/:id/logs` | GET | Session token | Structured job logs |
