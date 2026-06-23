---
name: implement
description: Use when the user asks to implement work items from Almirant. Accepts any combination of task, story, feature, or epic IDs.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Implement Skill

You are given **one or more work item IDs** (e.g. `A-425`, `A-F-125`, `MC-10`). They can be tasks, stories, features, or epics. Your job is to resolve them to leaf tasks, analyze dependencies, and implement them in parallel waves via subagents.

Provider rule:

- Resolve `ACTIVE_PROVIDER` from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:

1. Resolve context (`get_implement_context`).
2. Prepare board execution state for all valid tasks (assignment + dependencies + reserve in Backlog).
3. Create/activate worktree and install deps.
4. Only then start coding and move wave tasks to In Progress.

If any gate fails, report the failure clearly and stop. Never edit files before gates 1-3 are completed.

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

## Step 2: Validate tasks

For each resolved task, check its `columnName`:

- **Valid**: "Backlog" (case-insensitive) -> include.
- **Skip**: "In Progress", "Reviewing", "Done", or any other column -> skip with warning.

Report to the user: `Found X pending tasks (Y skipped)`

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

## Step 6: Create worktree for session isolation

Before executing any waves, isolate changes in a dedicated worktree. This allows multiple `/implement` sessions to run in parallel without conflicts, and leaves the main repo's working directory untouched.

### 6a. Detect if already in a worktree

```bash
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
```

**Decision logic:**

- If `git rev-parse` fails entirely -> not a git repo. Set `WORKTREE_PATH` to the current working directory, `CREATED_WORKTREE = false`, and skip to Step 7 (backwards compatibility).
- If `GIT_COMMON_DIR` contains `.git/worktrees/` -> already inside a worktree. Set `WORKTREE_PATH` to `$(git rev-parse --show-toplevel)`, `CREATED_WORKTREE = false`, and skip to Step 7.
- Otherwise -> in the main repository. Proceed to 6b.

If already in a worktree, also check if the current branch matches a feature convention (`epic/MC-*`, `feature/MC-*`, `task/MC-*`, `implement/MC-*`). If so, this is a re-run -- report it and continue.

### 6b. Determine branch name

Use the **highest-level input ID** to derive the prefix:

| Input scope | Branch prefix | Example |
|---|---|---|
| Single epic (`MC-E-XX`) | `epic/` | `epic/MC-E-19-git-branch-strategy` |
| Single feature (`MC-F-XX`) | `feature/` | `feature/MC-F-42-pr-skill` |
| Single task (`MC-XXX`) | `task/` | `task/MC-568-branch-creation` |
| Multiple mixed IDs | `implement/` | `implement/MC-568-MC-571` |

Slug generation from the work item title:

```
title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
```

Full branch name: `<prefix><ID>-<slug>` (e.g. `epic/MC-E-19-git-branch-strategy`)

### 6c. Fetch and check for existing remote branch

```bash
git fetch origin
```

Check if a remote branch already exists for this work item (re-run or retry scenario):

```bash
git branch -r --list "origin/<branch-name>"
```

### 6d. Create the worktree

Get the repository root (needed for `.worktrees/` path):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
```

**If an existing remote branch was found** (re-run / retry):

```bash
git worktree add --track -b "<branch-name>" "$REPO_ROOT/.worktrees/<branch-name>" "origin/<branch-name>"
```

**If no existing remote branch** (fresh start):

```bash
git worktree add "$REPO_ROOT/.worktrees/<branch-name>" -b "<branch-name>" origin/main
```

If `git worktree add` fails because the branch already exists locally (previous incomplete run), remove the stale worktree first:

```bash
git worktree remove "$REPO_ROOT/.worktrees/<branch-name>" --force 2>/dev/null
git branch -D "<branch-name>" 2>/dev/null
```

Then retry the worktree creation.

Set the variables:

```bash
WORKTREE_PATH="$REPO_ROOT/.worktrees/<branch-name>"
CREATED_WORKTREE=true
```

### 6e. Install dependencies in the worktree

The worktree shares `.git` but has its own `node_modules`. Dependencies must be installed:

```bash
cd "$WORKTREE_PATH" && bun install
```

### 6f. Confirm to user

```
Worktree created at: $WORKTREE_PATH
Branch: <branch-name> (based on origin/main)
Dependencies installed.
```

**Important**: From this point forward, ALL file operations, builds, type-checks, and git commands must use `WORKTREE_PATH` as the working directory.

## Progress Reporting (mandatory)

Report progress in natural language throughout execution. OpenClaw relays normal agent output and structured session events to Discord.

```
- Tell the user: Resolviendo tareas y calculando waves...
- Tell the user: Worktree creado en .worktrees/feature/A-F-XXX — instalando dependencias...
- Wave launch example: frontend-developer|A-425|Drawer component :: backend-architect|A-426|API endpoint
- Agent completion example: frontend-developer|A-425|SUCCESS
- Agent completion example: backend-architect|A-426|FAILED|type error in routes/items.ts
- Wave completion example: 1/2 success
- Tell the user: Committing cambios y pusheando rama...
- Tell the user: Creando PR...
- Final success example: "PR creada: <pull-request-url>"
- Warning example: Completado con 1 tarea fallida — ver detalles arriba
- Failure example: <motivo si falla completamente>
```

Report success clearly on full success, a warning if some tasks failed, an error if everything failed. Never skip the final outcome summary.

## Step 7: Show execution plan (informative, proceed immediately)

Display the execution plan to the user:

```
Execution plan:
  Worktree: $WORKTREE_PATH
  Branch: <branch-name>
  Wave 1 (parallel): N tasks
    - MC-XX: "Title" -> [agent]
    - MC-YY: "Title" -> [agent]
  Wave 2 (after Wave 1): M tasks
    - MC-ZZ: "Title" -> [agent] (blocked by MC-XX)
```

Proceed immediately -- do NOT wait for user approval.

## Step 8: Execute

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

#### 8-pre. Resolve implementation metadata

Before starting the wave loop, resolve the following values that will be passed to `complete_ai_task`:

1. **Coding agent** (`CODING_AGENT`): Read the `ALMIRANT_CODING_AGENT` environment variable. If not set, default to `"claude-code"`.
2. **Current user ID** (`CURRENT_USER_ID`): Call `get_current_user()` MCP tool and cache the returned user ID for use as `requestedByUserId`. If the call fails or returns no ID, set to `undefined` (do not fail the skill).
3. **AI model**: Will be determined per-task from the actual model reported by the subagent. By default this is the inherited session model selected by the user.

Cache `CODING_AGENT` and `CURRENT_USER_ID` once here -- reuse them for every `complete_ai_task` call across all waves.

#### 8a. Move wave tasks to In Progress

For each board represented in the wave:

1. `batch_move_work_items(workItemIds, inProgressColumnId, setAiProcessing: true, aiProvider: ACTIVE_PROVIDER)`
2. Record `waveStartedAt` (ISO 8601 UTC) for duration tracking.

#### 8b. Explore codebase for all wave tasks (orchestrator does this)

For each task in the current wave, the orchestrator uses Serena to gather context.

**Important**: If `WORKTREE_PATH` is set, all file exploration should reference paths within `WORKTREE_PATH` since that is where the subagents will be working.

1. Identify which files/domains the task will likely touch (based on title, description, type).
2. Use `get_symbols_overview` on those files to understand their structure.
3. Use `find_symbol` (with `include_body: true`) on the specific functions/components that will need modification or serve as reference patterns.
4. Use `search_for_pattern` if needed to find usage patterns, translation keys, or similar implementations.

Collect this information to build a rich prompt for each specialist. The goal: the specialist should have enough context to implement without needing Serena.

#### 8c. Launch specialist subagents in parallel

For each task in the current wave, launch a **specialist subagent** using the `Task` tool with:

- `subagent_type`: The specialist from the agent selection tables above (e.g. `frontend-developer`, `backend-architect`).
- `model`: Omit it by default so the subagent inherits the current agent/session model selected by the user.
- `description`: `"Implement MC-XXX"`
- `run_in_background`: `true`
- `prompt`: Use the subagent prompt template below, enriched with the code context gathered in step 8b.

**CRITICAL**: Launch ALL tasks in the wave in a **single message** with multiple `Task` tool calls to ensure true parallel execution.

#### Subagent prompt template

```
You are implementing work item {TASK_ID}: "{TITLE}"

## Task Details
- **Type**: {TYPE} | **Priority**: {PRIORITY}
- **Description**: {DESCRIPTION}
- **Definition of Done**: {DOD or "Not specified"}

## Working Directory

All work MUST happen inside the worktree at: {WORKTREE_PATH}

Use these paths for checks and file operations:
- Frontend root: {WORKTREE_PATH}/frontend
- Backend root: {WORKTREE_PATH}/backend

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
   - `cd {WORKTREE_PATH}/frontend && bun run type-check` (if frontend changes)
   - `cd {WORKTREE_PATH}/frontend && bun run lint` (if frontend changes)
   - `cd {WORKTREE_PATH}/backend && bun run type-check` (if backend changes)
   - Fix any errors before proceeding.

3. **Report**: List files changed, what was implemented, decisions made, and a `userActions` section with a Markdown bullet list of manual steps the user needs to verify. If nothing pending, state "No user actions needed."
```

#### 8d. Wait for completion and parse results

After launching, wait for all background agents to complete.

For each completed agent, parse the `<usage>` tag from the subagent's output. The tag has this exact format:

```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Extract `total_tokens` (integer) and `duration_ms` (integer) from it. If the tag is missing, compute `durationMs` from `waveStartedAt` to now and set `totalTokens` to 0.

Also parse `userActions` from the subagent's Report section (the Markdown bullet list, or empty string if "No user actions needed").

Classify each agent result as SUCCESS or FAILED based on its output.

#### 8e. Commit wave changes

After ALL subagents in the wave have completed (and before calling `complete_ai_task`), commit the changes for each successful task **sequentially**.

**All git operations MUST run from `WORKTREE_PATH`.**

For each successfully completed task in this wave:

1. **Stage all changes**:

   ```bash
   cd "$WORKTREE_PATH" && git add -A
   ```

2. **Infer commit type** from the task title:
   - Title contains "fix" or "bug" (case-insensitive) -> `fix`
   - Title contains "refactor" (case-insensitive) -> `refactor`
   - Default -> `feat`

3. **Create commit** using HEREDOC for proper formatting:

   ```bash
   cd "$WORKTREE_PATH" && git commit -m "$(cat <<'EOF'
   feat(MC-XXX): Task title here
   EOF
   )"
   ```

4. **Link commit to Almirant** (best-effort, do not block on failure):

   ```bash
   cd "$WORKTREE_PATH" && git rev-parse HEAD
   ```

   Then call `link_commit_to_work_item(workItemId: "<task-UUID>", sha: "<SHA>", message: "<commit-message>", branch: "<branch-name>")`.
   If the MCP call fails, log a warning and continue — webhook auto-linking will handle it as a fallback. The link is idempotent.

5. **If commit fails** (nothing to commit -- e.g. the task only modified files already committed by a previous task in this wave), **continue without error**. Do not abort the wave. Skip step 4 as well.

**Important**: If multiple tasks in a wave modified overlapping files, the first `git add -A && git commit` will capture all changes. Subsequent commits for other tasks may have nothing to commit -- this is fine, skip silently.

#### 8f. Update board and record AI sessions

For each agent result from 8d:

1. **If SUCCESS** -- use a **single call** to `complete_ai_task`:

   ```
   complete_ai_task(
     workItemId: "<UUID>",
     reviewColumnId: "<Reviewing column UUID>",
     userActions: "<parsed userActions or empty string>",
     model: "<MODEL_USED_BY_SUBAGENT>",
     provider: ACTIVE_PROVIDER,
     totalTokens: <total_tokens from usage tag>,
     durationMs: <duration_ms from usage tag>,
     sessionType: "implement",
     taskId: "MC-XXX",
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
  - MC-XX: "Title" -- committed & completed -> Reviewing (~Nk tokens, ~$X.XX)
  - MC-YY: "Title" -- failed: [brief reason] -> Backlog
```

#### 8f-bis. Save implementation memory

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

#### 8g. Re-evaluate blocked tasks

After a wave completes:

- Check if blocked tasks have all their dependencies completed.
- Newly unblocked tasks become **ready** for the next wave.
- Tasks blocked by failed tasks are **skipped** with reason.
- If there are ready tasks, start the next wave (go to 8a).
- If no more tasks can be unblocked, stop the loop.

#### 8h. Push branch (after all waves complete)

After the last wave finishes and there are no more waves to execute:

1. **Check if there are any commits to push**:

   ```bash
   cd "$WORKTREE_PATH" && git log origin/main..HEAD --oneline
   ```

   If no output (no new commits), skip push and PR -- report "No changes were made" and proceed to cleanup.

2. **Push the branch** to remote (only if git credentials are available):

   ```bash
   cd "$WORKTREE_PATH" && git push -u origin <branch-name>
   ```

   If push fails with an authentication error, skip it -- the runner will collect and push changes externally after the session completes.

3. **Report** the branch name and push status.

#### 8i. Create PR (after push)

After a successful push, create a Pull Request automatically:

1. **Build PR title** from the highest-level input ID and its title:

   ```
   [MC-XXX] Title of the work item
   ```

   Keep under 70 characters.

2. **Build PR body** from the completed tasks:

   ```bash
   cd "$WORKTREE_PATH" && gh pr create --title "[MC-XXX] Title" --body "$(cat <<'EOF'
   ## Summary
   - Brief description of what was implemented

   ## Tasks completed
   - [MC-XX] Task title 1
   - [MC-YY] Task title 2

   ## Test plan
   - [ ] TypeScript compiles without errors
   - [ ] ESLint passes
   - [ ] Manual verification of [specific areas]

   ---
   Generated with [Claude Code](https://claude.ai/claude-code)
   EOF
   )"
   ```

3. **If `gh` is not available** or the PR creation fails, report the branch name and suggest the user create the PR manually or use the `/pr` skill.

4. **Report** the PR URL to the user.

#### 8j. Cleanup worktree (after push/PR)

**Only if `CREATED_WORKTREE` is true** (we created the worktree in Step 6, not the user):

1. **Return to the main repository root**:

   ```bash
   cd "$REPO_ROOT"
   ```

2. **Remove the worktree**:

   ```bash
   git worktree remove ".worktrees/<branch-name>" --force
   ```

3. **Delete the local branch** (remote branch is kept for the PR):

   ```bash
   git branch -D "<branch-name>"
   ```

4. **Report** cleanup completion.

**If `CREATED_WORKTREE` is false** (user was already in a worktree), do NOT clean up. The user manages their own worktree lifecycle.

## Step 9: Summary report

Present a final summary:

```
## Summary

**Total**: N | **Completed**: X | **Failed**: Y | **Skipped**: Z

| Task | Title | Status | Commit |
|------|-------|--------|--------|
| MC-XX | Title | :white_check_mark: Completed | `abc1234` |
| MC-YY | Title | :white_check_mark: Completed | `def5678` |
| MC-ZZ | Title | :x: Failed | — |
| MC-WW | Title | :fast_forward: Skipped (blocked by MC-ZZ) | — |

### :hammer_and_wrench: Changes

- **MC-XX**: [Brief summary of what was implemented]
  `path/to/file1.ts` · `path/to/file2.tsx`

- **MC-YY**: [Brief summary]
  `path/to/file3.ts`

### :x: Failed (if any)
- **MC-ZZ**: [Error or reason]

### :link: Branch & PR
Branch: `<branch-name>`
PR: <PR-URL> (or "Use `/pr` to create a Pull Request" if PR creation was skipped)

### :clipboard: Next steps
- [ ] [Any manual verification needed]
- [ ] [Commands to run if applicable]
```
