# End-to-End Flow: Discord -> Runner -> OpenCode -> Discord

This document describes the full lifecycle of a remote agent job triggered from
Discord and executed by the runner service.

---

## Architecture Overview

```
Discord Server
  |
  | (1) /implement A-123
  v
Almirant Backend (Elysia API)
  |
  | (2) Create agent_job row + Discord thread
  v
PostgreSQL (agent_jobs table, status = "queued")
  |
  | (3) Runner polls /workers/jobs/claim
  v
Runner Service (services/runner)
  |
  | (4) Create sibling Docker container
  v
OpenCode Container
  |
  | (5) Executes skill (implement/plan)
  |
  | (6) Output streamed via OpenCode /serve API
  v
Runner -> Discord Thread (via Bot API)
  |
  | (7) If agent needs input -> interaction created
  v
Discord User answers via buttons/select
  |
  | (8) Backend stores response in agent_interactions
  v
Runner polls for answer -> relays to OpenCode
  |
  | (9) On completion -> job status updated
  v
Discord thread renamed with result status
```

---

## Step-by-Step Flow

### 1. Discord User Runs Slash Command

A user in a Discord server executes `/implement A-123` (or `/plan A-123`).

- Discord sends an interaction webhook to `POST /webhooks/discord/interactions`
  on the Almirant backend.
- The backend verifies the Ed25519 signature using `DISCORD_PUBLIC_KEY`.
- The handler returns an immediate `DEFERRED_CHANNEL_MESSAGE` (type 5) to
  acknowledge the interaction within the 3-second deadline.

**Optional parameter**: The user can specify a `provider` option
(`codex`, `claude-code`, or `zipu`). If omitted, defaults to `codex`.

### 2. Backend Creates Job + Discord Thread

The `queueCommandJob` function in `discord-interactions.routes.ts`:

1. Resolves the work item by `taskId` (e.g., `A-123`).
2. Creates a Discord thread in the source channel named
   `implement-A-123` (via the Bot API, thread type 12 = private thread).
3. Creates an `agent_jobs` row with:
   - `status = "queued"`
   - `provider` = user-selected or default
   - `jobType` = `"implementation"` or `"planning"`
   - `config` containing:
     - `skillName` (implement/plan)
     - `requesterDiscordUserId`
     - `sourceChannelId` / `sourceGuildId`
     - `threadId` (the Discord thread created in step 2)
4. Sends an ephemeral follow-up to the user with the job ID, provider, and
   a link to the thread.

### 3. Runner Claims the Job

The runner service (`services/runner`) runs a polling loop
(`RunnerOrchestrator.claimAndRun`) that periodically calls:

```
POST /workers/jobs/claim
{ workerId, count, activeJobs }
```

The backend uses `SELECT ... FOR UPDATE SKIP LOCKED` to atomically claim
queued jobs and move them to `status = "running"`.

The runner receives a `ClaimedJob` object containing the full `config` with
all Discord metadata (threadId, sourceChannelId, etc.).

### 4. Runner Creates a Container

The `JobExecutor.execute` method:

1. Resolves the work item details from the backend API.
2. Builds the injected environment (API keys, MCP config, repo URL, branch).
3. Resolves the runtime config based on the provider (opencode, claude-shim,
   or codex-shim).
4. Creates a Docker container spec with:
   - Tmpfs mounts for workspace isolation
   - Security hardening (read-only rootfs, cap-drop ALL)
   - Entrypoint that clones the repo and starts OpenCode in `/serve` mode
5. Pulls the image and creates the container.

### 5. Container Runs OpenCode with the Prompt

Inside the container, the entrypoint script:

1. Clones the repository into `/workspace/repo`.
2. Checks out the target branch.
3. Starts `opencode serve` listening on port 4096.
4. The runner waits for the serve endpoint to become ready (up to 180s).
5. Once ready, the runner sends the task prompt via the OpenCode session API:
   - For implementation: `opencode run --command implement "A-123"`
   - For planning: `opencode run --command plan "A-123"`

### 6. Output Streams to Discord Thread

If Discord is configured and a `threadId` exists in the job config, the runner:

1. Sets up a `DiscordRichChannelAdapter` with the bot token.
2. Either reuses the pre-created thread (from the `threadId` in job config)
   or creates a new thread as fallback.
3. Creates a `BidirectionalRelay` that connects:
   - OpenCode activity events -> Discord messages (throttled at 1.5s)
   - Sticky session control buttons (Stop/Shutdown) pinned at the bottom
4. Activity events are streamed as live-updating messages in the thread.
5. New messages are created when the activity type changes or after a
   3-second silence gap.

### 7. Agent Asks a Question (Interaction)

When OpenCode encounters a decision point (e.g., multiple implementation
approaches), it creates an interaction request:

1. The runner detects the pending interaction via the OpenCode session API.
2. The runner calls `POST /workers/jobs/{jobId}/interactions` on the backend
   to create an `agent_interactions` row with `status = "pending"`.
3. The runner posts a Discord message with interactive components
   (buttons or a select menu) representing the options.
4. The job status moves to `waiting_for_input`.

### 8. Discord User Answers

1. The user clicks a button or selects an option in the Discord thread.
2. Discord sends a `MESSAGE_COMPONENT` interaction to the backend webhook.
3. The `handleAnswerComponent` function:
   - Finds the pending interaction for the job.
   - Records the selected answer via `respondToInteraction`.
   - Moves the job status back to `running`.
   - Updates the Discord message to show the selected answer (disabled).

### 9. Runner Polls for Answer

1. The runner polls `GET /workers/jobs/{jobId}/interactions/pending` at
   regular intervals (1.5s).
2. When the interaction is resolved, it reads the `response` field.
3. The runner relays the answer back to the OpenCode session.
4. OpenCode continues execution with the user's choice.

### 10. Job Completion

When the OpenCode session finishes:

1. The runner waits a short idle period (15s) for final activity events.
2. Collects the execution result (summary, files changed, exit code).
3. Calls `PATCH /workers/jobs/{jobId}/status` with:
   - `status = "completed"` (or `"failed"`)
   - `result` containing `threadId`, summary, metrics
   - `durationMs`, `tokensUsed`, `cost` if available
4. Updates the Discord session control buttons to "completed" state.
5. Renames the Discord thread to include the result status
   (e.g., `implement-A-123 [done]`).
6. Removes the Docker container.

---

## Error Handling

| Failure Point | Behavior |
|---|---|
| Work item not found | Ephemeral error to Discord user, no job created |
| Thread creation fails | Job proceeds without Discord relay |
| Container creation fails | Job marked as `failed` with error details |
| OpenCode serve timeout | Container killed, job retried (up to `maxRetries`) |
| Overall timeout (60 min) | Container killed, job marked as `failed` |
| User cancels via Stop btn | Job marked as `cancelled`, container removed |
| User clicks Shutdown btn | Job marked as `cancelled` with `shutdownRequested` flag |

---

## Manual Testing Checklist

### Prerequisites

- [ ] Backend API running at `ALMIRANT_API_URL` (e.g., `http://localhost:3001`)
- [ ] PostgreSQL with migrated schema
- [ ] Docker daemon running on runner host
- [ ] Runner `.env` configured with valid `ALMIRANT_API_KEY`
- [ ] Discord bot token configured in both backend and runner `.env`
- [ ] Discord bot added to the test server with proper permissions
  (Send Messages, Create Public Threads, Manage Threads, Use Slash Commands)
- [ ] At least one work item exists (e.g., `A-123`) linked to a project with
  a repository configured
- [ ] Slash commands registered with Discord
  (`POST /applications/{appId}/commands`)

### Stage 1: Job Creation (Discord -> Backend)

- [ ] Run `/implement A-123` in a Discord channel
- [ ] Verify ephemeral "Processing /implement..." message appears
- [ ] Verify a new thread is created in the channel (named `implement-A-123`)
- [ ] Verify the follow-up message includes: Job ID, Provider, Work item, Thread link
- [ ] Check database: `SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT 1`
  - `status` should be `queued`
  - `config` should contain `threadId`, `sourceChannelId`, `sourceGuildId`,
    `requesterDiscordUserId`, `skillName`

### Stage 2: Job Claiming (Runner)

- [ ] Start the runner: `cd services/runner && docker compose -f docker-compose.prod.yml up -d`
- [ ] Verify health: `curl -fsS http://localhost:3002/health`
- [ ] Watch runner logs: `docker compose -f docker-compose.prod.yml logs -f runner`
- [ ] Confirm log line: `[job:<id>] Preparing isolated workspace...`
- [ ] Check database: job `status` should be `running`, `worker_id` should be set

### Stage 3: Container Execution

- [ ] Verify a Docker container was created: `docker ps --filter label=almirant.job_id`
- [ ] Verify the container has the expected image and labels
- [ ] Monitor container logs if needed: `docker logs -f <container_id>`

### Stage 4: Discord Streaming

- [ ] Verify the Discord thread receives live activity messages
- [ ] Verify session control buttons appear (Stop / Shutdown)
- [ ] Verify messages update in-place (edit, not spam)

### Stage 5: Interaction (if applicable)

- [ ] If the agent asks a question, verify buttons/select appear in the thread
- [ ] Click an option and verify:
  - The message updates to show the selection
  - Job status returns to `running`
  - The agent continues

### Stage 6: Completion

- [ ] Verify job status transitions to `completed` or `failed`
- [ ] Verify the Discord thread is renamed with result status
- [ ] Verify session controls show final state
- [ ] Verify the container is removed: `docker ps -a --filter label=almirant.job_id`
  should show no containers for the job
- [ ] Check database: `completedAt`, `durationMs`, `result` fields populated

### Stage 7: Provider Selection

- [ ] Run `/implement A-123 provider:claude-code`
- [ ] Verify the job is created with `provider = "claude-code"`
- [ ] Run `/plan A-456` (no provider option)
- [ ] Verify the job defaults to `provider = "codex"`

### Stage 8: Error Cases

- [ ] Run `/implement NONEXISTENT-999`
- [ ] Verify ephemeral error: "Work item not found: NONEXISTENT-999"
- [ ] Click "Stop" on an active job
- [ ] Verify job transitions to `cancelled`
- [ ] Verify container is cleaned up

### Stage 9: Cleanup

- [ ] Stop the runner: `docker compose -f docker-compose.prod.yml down`
- [ ] Verify no orphaned containers remain:
  `docker ps -a --filter label=almirant.managed=true`
