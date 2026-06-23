---
name: runner-implement
description: Remote runner variant of implement. Works inside a pre-configured container with a pre-created branch and draft PR. Commits once after all tasks complete.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Runner Implement Skill

You are given **one or more work item IDs** (e.g. `A-425`, `A-F-125`, `MC-10`). They can be tasks, stories, features, or epics. Your job is to resolve them to leaf tasks, analyze dependencies, and implement them -- committing locally per wave and pushing **once after all waves complete** to minimize CI runs.

Provider rule:
- Read `ACTIVE_PROVIDER` from the environment variable `ALMIRANT_PROVIDER` (values: `anthropic`, `openai`, `zai`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Key Differences from `/implement`

This skill runs inside a **runner container** where:
- The branch and draft PR are already created by the job executor. Do NOT create a new branch or PR.
- The workspace is pre-configured at the current working directory. Do NOT create a worktree.
- Git credentials are already configured. You can push directly.
- Changes are committed locally per wave and pushed **once after all waves complete**. If the container dies mid-run, an orphan recovery process detects unpushed code on disk and pushes it automatically.
- The PR URL is available via the `ALMIRANT_PR_URL` environment variable. Include it in the final summary.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:
1. Resolve context (`get_implement_context`).
2. Prepare board execution state for all valid tasks (assignment + dependencies + reserve in Backlog).
3. Execute tasks wave-by-wave, then commit and push once after all waves complete.

If any gate fails, report the failure clearly and stop. Never edit files before gates 1-2 are completed.

## Step 1: Parse input and resolve context

Split `$ARGUMENTS` by whitespace to extract the list of IDs. Accept the workspace work-item format (e.g. `A-425`, `A-F-125`, `MC-10`, `MC-F-42`) and do not hardcode a single prefix.

If no valid IDs are found, tell the user and stop.

Use a single call:
1. `get_implement_context(ids: [ ...input IDs... ])`
2. Read:
   - `tasks.valid`: pending leaf tasks ready to execute
   - `tasks.skipped`: tasks skipped with `skipReason`
   - `boardContext`: semantic `columnMap` per board
   - `waves`: precomputed execution waves (dependency-aware)
3. If `tasks.valid` is empty, report skips and stop.

## Step 1-bis: Load shared memory before coding

Before changing code, load reusable prior context:

1. Call `mem_context` with the resolved `projectId`, `types: ["decision", "pattern", "bugfix"]`, and a small `limit`.
2. Build a focused query from the resolved task titles/descriptions and call `mem_search`.
3. Use the retrieved learnings only as guidance. Ignore anything that looks like noise or audit log.

## Step 2: Validate tasks

For each resolved task, check its `columnName`:
- **Valid**: "Backlog" (case-insensitive) -> include.
- **Stale In Progress** (recoverable): "In Progress" tasks that meet ALL of these conditions are treated as abandoned and included:
  1. `isAiProcessing` is `true` (was being processed by AI)
  2. The task has no linked commits (check `metadata.commits` or absence of commit links)
  3. The task has no recent activity (no comments or events in the last 30 minutes)
  When detected, move these tasks to "Backlog" using `batch_move_work_items` before including them. Log: `Recovered N stale In Progress tasks (likely from a previous timed-out run)`.
- **Skip**: "In Progress" (not matching stale conditions above), "Reviewing", "Done", or any other column -> skip with warning.

Report to the user: `Found X pending tasks (Y recovered from stale In Progress, Z skipped)`

If ALL tasks are skipped/invalid, stop here.

## Step 3: Use pre-resolved board structure

Use `boardContext[].columnMap` from Step 1.
No regex matching on column names. If any required column is missing (`backlog`, `inProgress`, `review`), report the board and stop for those tasks.

## Step 4: Prepare board execution state for all valid tasks

This step is mandatory before any code changes.

### 4a. Ensure assignee for each valid task

For each task in `tasks.valid`:
- If task already has assignee/responsible user, keep it.
- If missing, set assignee to:
  - `task.createdByUserId` if present, otherwise
  - current authenticated user id (`get_current_user`), otherwise
  - leave unchanged and report a warning.

Use `update_work_item(id, assignee)` for missing assignments.

### 4b. Ensure dependency graph is persisted

Use `dependencies` from `get_implement_context` as source of truth.
For each dependency edge:
- `workItemId` is blocked by `blockedByWorkItemId`.
- Ensure it exists in Almirant via `add_work_item_dependency(workItemId, blockedByWorkItemId)`.
- Ignore duplicate-edge errors (already linked).

### 4c. Reserve all valid tasks in Backlog + flag AI processing

Use `batch_move_work_items` per board:

`batch_move_work_items(workItemIds, backlogColumnId, setAiProcessing: true, aiProvider: ACTIVE_PROVIDER)`

This minimizes calls and updates provider metadata consistently.

## Step 5: Use precomputed dependency waves

Take execution order directly from `waves` in `get_implement_context`.
No client-side N+1 dependency calls or local topological sort needed.

## Progress Reporting (mandatory)

Report progress in natural language throughout execution. The runner relays normal agent output and structured session events to Discord.

```
- Tell the user: Resolviendo tareas y calculando waves...
- Tell the user: Preparando board state para N tareas...
- Wave launch example: frontend-developer|A-425|Drawer component :: backend-architect|A-426|API endpoint
- Agent completion example: frontend-developer|A-425|SUCCESS
- Agent completion example: backend-architect|A-426|FAILED|type error in routes/items.ts
- Wave completion example: 1/2 success
- Tell the user: Committing all changes and pushing branch...
- Final success example: Todas las tareas completadas y pusheadas
- Warning example: Completado con 1 tarea fallida
- Failure example: <motivo si falla completamente>
```

Report success clearly on full success, a warning if some tasks failed, an error if everything failed. Never skip the final outcome summary.

## Step 6: Show execution plan (informative, proceed immediately)

Display the execution plan to the user:

```
Execution plan:
  Branch: <current branch>
  Wave 1 (parallel): N tasks
    - A-XX: "Title" -> [agent]
    - A-YY: "Title" -> [agent]
  Wave 2 (after Wave 1): M tasks
    - A-ZZ: "Title" -> [agent] (blocked by A-XX)
```

Proceed immediately -- do NOT wait for user approval.

## Step 7: Execute waves

### Agent selection rules

Analyze each task's description, title, and expected file patterns to select the best specialist agent.

| Task involves | Agent (`subagent_type`) | Model param |
|---|---|---|
| Frontend components (`.tsx`), React UI, presentational components | `frontend-developer` | _(inherit -- do NOT pass `model`)_ |
| Frontend hooks, state management, React Query | `frontend-developer` | _(inherit)_ |
| Clean Architecture compliance, DDD layer separation | `frontend-clean-architect` | _(inherit selected session model -- do NOT pass `model`)_ |
| Backend routes, Elysia endpoints, middleware | `backend-architect` | _(inherit selected session model -- do NOT pass `model`)_ |
| Database schema, Drizzle queries, repositories | `database-architect` | _(inherit selected session model -- do NOT pass `model`)_ |
| Pure TypeScript logic, utilities, transformers | `javascript-pro` | _(inherit)_ |
| API documentation, endpoint docs | `api-documenter` | _(inherit)_ |
| Database query optimization | `database-optimizer` | _(inherit)_ |
| UI/UX design decisions, layout, responsiveness | `ui-ux-designer` | _(inherit selected session model -- do NOT pass `model`)_ |
| Error investigation, debugging | `error-detective` | _(inherit)_ |

### File type to agent mapping

| File pattern | Recommended agent |
|---|---|
| `frontend/src/domains/*/presentation/components/*.tsx` | `frontend-developer` |
| `frontend/src/domains/*/presentation/containers/*.tsx` | `frontend-developer` |
| `frontend/src/domains/*/application/hooks/*.ts` | `frontend-developer` |
| `frontend/src/domains/*/domain/types.ts` | `javascript-pro` or `frontend-developer` |
| `frontend/src/components/ui/*.tsx` | `frontend-developer` + `ui-ux-designer` |
| `backend/api/src/routes/*.ts` | `backend-architect` |
| `backend/api/src/middleware/*.ts` | `backend-architect` |
| `backend/api/src/lib/*.ts` | `backend-architect` or `javascript-pro` |
| `backend/packages/database/src/schema/*.ts` | `database-architect` |
| `backend/packages/database/src/repositories/*.ts` | `database-architect` |
| `backend/packages/database/migrations/*` | `database-architect` |

### Wave execution with specialist subagents

The orchestrator **always** delegates implementation to specialist subagents -- even for a single task. This ensures accurate token tracking via the `<usage>` tag and keeps the orchestrator focused on coordination.

The orchestrator explores the codebase with Serena, prepares rich context prompts, and launches specialist subagents in parallel.

Repeat until all pending tasks are either completed or failed:

#### 7-pre. Resolve implementation metadata

Before starting the wave loop, resolve the following values that will be passed to `complete_ai_task`:

1. **Coding agent** (`CODING_AGENT`): Read the `ALMIRANT_CODING_AGENT` environment variable. If not set, default to `"claude-code"`.
2. **Current user ID** (`CURRENT_USER_ID`): Call `get_current_user()` MCP tool and cache the returned user ID for use as `requestedByUserId`. If the call fails or returns no ID, set to `undefined` (do not fail the skill).
3. **AI model**: Will be determined per-task from the actual model reported by the subagent. By default this is the inherited session model selected by the user.

Cache `CODING_AGENT` and `CURRENT_USER_ID` once here -- reuse them for every `complete_ai_task` call across all waves.

#### 7a. Move wave tasks to In Progress

For each board represented in the wave:
1. `batch_move_work_items(workItemIds, inProgressColumnId, setAiProcessing: true, aiProvider: ACTIVE_PROVIDER)`
2. Record `waveStartedAt` (ISO 8601 UTC) for duration tracking.

#### 7b. Explore codebase for all wave tasks (orchestrator does this)

For each task in the current wave, the orchestrator uses Serena to gather context.

1. Identify which files/domains the task will likely touch (based on title, description, type).
2. Use `get_symbols_overview` on those files to understand their structure.
3. Use `find_symbol` (with `include_body: true`) on the specific functions/components that will need modification or serve as reference patterns.
4. Use `search_for_pattern` if needed to find usage patterns, translation keys, or similar implementations.

Collect this information to build a rich prompt for each specialist. The goal: the specialist should have enough context to implement without needing Serena.

#### 7c. Launch specialist subagents in parallel (with batch limit)

**MAX_CONCURRENT_AGENTS = 5** — never launch more than 5 agents simultaneously. This prevents tmpfs exhaustion in the container.

For each task in the current wave, launch a **specialist subagent** using the `Task` tool with:

- `subagent_type`: The specialist from the agent selection tables above (e.g. `frontend-developer`, `backend-architect`).
- `model`: Omit it by default so the subagent inherits the current agent/session model selected by the user.
- `description`: `"Implement <TASK_ID>"`
- `run_in_background`: `true`
- `prompt`: Use the subagent prompt template below, enriched with the code context gathered in step 7b.

**Sub-batching**: If the wave has more than MAX_CONCURRENT_AGENTS tasks, split into sub-batches:

1. Divide wave tasks into groups of MAX_CONCURRENT_AGENTS (last group may be smaller).
2. For each sub-batch:
   a. Report the sub-batch launch in prose, including agent, task id, title, and batch number.
   b. Launch ALL sub-batch tasks in a **single message** with multiple `Task` tool calls.
   c. Wait for all sub-batch agents to complete (step 7d).
   d. Set categorized outcomes and update board (steps 7e-bis, 7f) for this sub-batch's tasks.
   e. Report the sub-batch completion in prose, including success count and batch number.
3. After all sub-batches complete, commit wave changes locally (step 7e), then proceed to step 7g (re-evaluate blocked tasks).

If the wave has MAX_CONCURRENT_AGENTS or fewer tasks, launch all in a **single message** (no sub-batching needed).

**CRITICAL**: Each sub-batch MUST be launched in a single message with multiple `Task` tool calls for true parallel execution.

#### Subagent prompt template

```
You are implementing work item {TASK_ID}: "{TITLE}"

## Task Details
- **Type**: {TYPE} | **Priority**: {PRIORITY}
- **Description**: {DESCRIPTION}
- **Definition of Done**: {DOD or "Not specified"}

## Working Directory

All work MUST happen in the current working directory (already set up by the runner).

## IMPORTANT: Do NOT commit or push

The orchestrator handles all git operations (commit, push) after your work is done. Do NOT run git add, git commit, or git push. Just implement, run checks, and report.

## Codebase Context (gathered by orchestrator)

{CONTEXT -- Include here:
  - Relevant file paths and their symbol overviews
  - Key function/component bodies that serve as reference patterns
  - Existing conventions observed (naming, structure, imports)
  - Any related code the specialist needs to understand
  Keep concise but complete -- the specialist cannot use Serena.}

## Instructions

1. **Implement** following project conventions:
   - DDD: domain types -> application hooks -> presentation components/containers
   - Clean Architecture: no classes, functional only, .tsx files are purely presentational (no useState, useEffect, etc.)
   - Follow the patterns shown in the Codebase Context above
   - Read CLAUDE.md for full architecture guidelines if needed

2. **Run checks** (only for the areas you changed):
   - `bun run type-check` in the relevant package root (frontend/ or backend/)
   - `bun run lint` in the relevant package root (frontend/ only)
   - Fix any errors before proceeding.

3. **Report**: List files changed, what was implemented, decisions made. Then provide these **categorized outcome sections** (use exact headers):

   ### Deploy Checklist
   Manual steps needed before/during production deployment. Examples: run migrations, set env vars, backfill data, update configs.
   If none needed, write "No deploy actions needed."

   ### Validation Checks
   Concrete verification steps to confirm the implementation works. Examples: navigate to /settings and verify button X exists, call API endpoint Y and check response Z.
   If none needed, write "No validation checks needed."

   ### Documentation Notes
   What aspects of this change need documentation. Examples: new API endpoint /api/foo, new settings page, changed config format.
   If none needed, write "No documentation needed."
```

#### 7d. Wait for completion and parse results

After launching, wait for all background agents to complete.

For each completed agent, parse the `<usage>` tag from the subagent's output. The tag has this exact format:
```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Extract `total_tokens` (integer) and `duration_ms` (integer) from it. If the tag is missing, compute `durationMs` from `waveStartedAt` to now and set `totalTokens` to 0.

Also parse the **categorized outcome sections** from the subagent's Report:
- `deployChecklist`: Content under "### Deploy Checklist" header (or empty string if "No deploy actions needed")
- `validationChecks`: Content under "### Validation Checks" header (or empty string if "No validation checks needed")
- `documentationNotes`: Content under "### Documentation Notes" header (or empty string if "No documentation needed")
- For backward compatibility: if the subagent uses the old `userActions` format instead, treat the entire content as `deployChecklist` and leave the other two empty.

Also parse legacy `userActions` as fallback for backward compatibility.

Classify each agent result as SUCCESS or FAILED based on its output.

#### 7e. Commit wave changes (local only — NO push)

After ALL subagents in the wave have completed, the orchestrator commits changes locally. **Do NOT push here** — a single push happens after all waves are done (step 7h).

For each successfully completed task in this wave:

1. **Check for uncommitted changes** (MANDATORY before every commit attempt):
   ```bash
   git add -A -- . \
     ':(exclude).mcp.json' \
     ':(exclude)opencode.json' \
     ':(exclude)CLAUDE.md' \
     ':(exclude)AGENTS.md' \
     ':(exclude).claude/**' \
     ':(exclude).agents/**'
   git status --porcelain -- . \
     ':(exclude).mcp.json' \
     ':(exclude)opencode.json' \
     ':(exclude)CLAUDE.md' \
     ':(exclude)AGENTS.md' \
     ':(exclude).claude/**' \
     ':(exclude).agents/**'
   ```
   Runner-managed files such as `.mcp.json`, `opencode.json`, `CLAUDE.md`, `AGENTS.md`, `.claude/`, and `.agents/` are intentionally excluded from staging. They are container/bootstrap artifacts, not implementation output.

   If the output is **empty** (no changes to commit), **skip this task's commit entirely** — do NOT run `git commit`. Log: `No changes to commit for <TASK-ID>, skipping.` Continue to the next task.

2. **Infer commit type** from the task title:
   - Title contains "fix" or "bug" (case-insensitive) -> `fix`
   - Title contains "refactor" (case-insensitive) -> `refactor`
   - Default -> `feat`

3. **Create commit** using HEREDOC for proper formatting:
   ```bash
   git commit -m "$(cat <<'EOF'
   feat(<TASK-ID>): Task title here
   EOF
   )"
   ```

   **NEVER use `--allow-empty`**. If there are no staged changes, you MUST skip the commit (step 1 already checks this).

**Important**: If multiple tasks in a wave modified overlapping files, the first commit captures all changes. Subsequent tasks will have nothing to commit — step 1 handles this by skipping the commit entirely.

#### 7e-bis. Set categorized outcomes

For each successfully completed task, call `set_implementation_outcomes` to persist the categorized outcomes in metadata:

```
set_implementation_outcomes(
  workItemId: "<UUID>",
  deployChecklist: "<parsed deployChecklist or empty string>",
  validationChecks: "<parsed validationChecks or empty string>",
  documentationNotes: "<parsed documentationNotes or empty string>"
)
```

This call is best-effort. If it fails, log a warning and continue — the data is also available from the subagent output.

#### 7f. Update board and record AI sessions

For each agent result from 7d:

1. **If SUCCESS** -- use a **single call** to `complete_ai_task`:
   ```
   complete_ai_task(
     workItemId: "<UUID>",
     reviewColumnId: "<Reviewing column UUID>",
     userActions: "<parsed deployChecklist or empty string>",
     model: "<MODEL_USED_BY_SUBAGENT>",
     provider: ACTIVE_PROVIDER,
     totalTokens: <total_tokens from usage tag>,
     durationMs: <duration_ms from usage tag>,
     sessionType: "implement",
     taskId: "<TASK-ID>",
     codingAgent: "<CODING_AGENT>",
     aiModel: "<MODEL_USED_BY_SUBAGENT>",
     requestedByUserId: "<CURRENT_USER_ID>"
   )
   ```
   - This atomically: moves to Reviewing, clears `isAiProcessing` + `aiReserved`, sets `userActions`, records the AI session with cost, and broadcasts WebSocket events.
   - **IMPORTANT**: The `model` parameter must be the model that the **subagent** actually used, NOT the orchestrator's model. In normal operation this is the inherited session model selected by the user.
   - **Model rule**: Do NOT translate agent type into a fixed model. Record the actual model that ran; by default this is the inherited session model selected by the user.

2. **If FAILED** (subagent errored or reported failure):
   - `move_work_item(workItemId, backlogColumnId)` -- moves back to Backlog for retry.
   - `update_work_item(id, metadata: { lastError: "<brief reason for failure>" })`

Report wave progress:
```
Wave N complete: X/Y tasks succeeded, Z failed
  - A-XX: "Title" -- completed -> Reviewing (~Nk tokens, ~$X.XX)
  - A-YY: "Title" -- failed: [brief reason] -> Backlog
```

#### 7f-bis. Save implementation memory

For each **successfully completed** task, call `workitem_save` to record the implementation context for future reference. This is best-effort -- if the call fails, log a warning and continue.

```
workitem_save(
  topicKey: "<taskId-slug>-implementation",   // e.g. "mc-t-42-implementation"
  title: "<brief summary of what was implemented>",
  workItemId: "<UUID>",
  taskId: "<TASK-ID>",                        // e.g. "MC-T-42"
  workItemType: "<task|story|feature|epic>",
  action: "implemented",
  description: "<what was implemented and how -- 2-3 sentences>",
  rationale: "<key design/architecture decisions made and why>",
  affectedFiles: ["<list of files created or modified>"],
  decisions: ["<key decisions made during implementation>"],
  learnings: ["<any lessons learned or gotchas discovered>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the subagent's report output (files changed, decisions made, implementation summary). The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-implementation`.

#### 7g. Re-evaluate blocked tasks

After a wave completes:
- Check if blocked tasks have all their dependencies completed.
- Newly unblocked tasks become **ready** for the next wave.
- Tasks blocked by failed tasks are **skipped** with reason.
- If there are ready tasks, start the next wave (go to 7a).
- If no more tasks can be unblocked, stop the loop.

#### 7h. Push all changes and link commits (after ALL waves complete)

After the last wave finishes and there are no more waves to execute, push all local commits in a single operation.

1. **Check if there are any commits to push**:
   ```bash
   git log origin/$(git branch --show-current)..HEAD --oneline
   ```
   If no output (no new commits), skip push -- report "No changes were made" and proceed to summary.

2. **Push the branch** to remote:
   ```bash
   git push
   ```
   If `git push` fails, retry once. If it still fails, log that Failure summary: Push failed and continue — the orphan recovery process will detect unpushed code on disk and push it later.

3. **Link commits to Almirant** (MANDATORY — do NOT skip):
   After push is confirmed (or skipped), link each successful task's commit to its work item.

   For each successfully completed task (across all waves):
   - Get the commit SHA from the local git log.
   - Call MCP:
     ```
     link_commit_to_work_item(
       workItemId: "<UUID>",
       sha: "<commit SHA>",
       message: "<commit message>",
       branch: "<current branch name>"
     )
     ```
   - If the call fails, log that Failure summary: Failed to link commit <SHA> to <TASK_ID> and continue.

   **Why this matters**: Without explicit linking, commits are invisible in Almirant's work item timeline. The webhook fallback is unreliable in runner containers.

Report that all changes are being committed and the branch is being pushed.

## Step 8: Summary report

Present a final summary. Read the `ALMIRANT_PR_URL` environment variable to include the PR link.

**CRITICAL**: The runner captures your **last text output** and uses it as the PR description body. The `## Summary` block MUST be the absolute last thing you output. Do NOT write any text, commentary, or explanation after the closing of the summary template below. No "done", no "completed", no wrap-up sentence. The summary IS your final message.

**DO NOT translate the heading `## Summary`**. Always use `## Summary` in English regardless of the job locale. The runner's completion guard matches this exact heading.

**Include ALL tasks** — not just those completed in this run. Tasks from `tasks.skipped` (already in "Reviewing" or "Done" from a previous run) must appear so the PR body reflects the full scope of work.

```
## Summary

**Total**: N | **Completed**: X | **Previously completed**: P | **Failed**: Y | **Skipped**: Z

| Task | Title | Status | Commit |
|------|-------|--------|--------|
| A-PP | Title | :white_check_mark: Previously completed | — |
| A-XX | Title | :white_check_mark: Completed | `abc1234` |
| A-YY | Title | :white_check_mark: Completed | `def5678` |
| A-ZZ | Title | :x: Failed | — |
| A-WW | Title | :fast_forward: Skipped (blocked by A-ZZ) | — |

### :hammer_and_wrench: Changes

- **A-XX**: [Brief summary of what was implemented]
  `path/to/file1.ts` · `path/to/file2.tsx`

- **A-YY**: [Brief summary]
  `path/to/file3.ts`

### :x: Failed (if any)
- **A-ZZ**: [Error or reason]

### :link: Branch & PR
Branch: `<current branch name>`
PR: <ALMIRANT_PR_URL value>

### :clipboard: Next steps
- [ ] Review changes in the PR
{Aggregated deployChecklist items from all completed tasks, if any}
```

**REMINDER**: Output the summary block above and STOP. Do not add any text after it.
