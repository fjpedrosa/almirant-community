---
name: validate
description: Unified validation pipeline for work items. Runs code review and testing for tasks in Reviewing column, moving them to Release (pass) or In Progress (fail).
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Validate Skill

You are given **one or more work item IDs** (e.g. `A-425`, `A-F-125`, `MC-10`). They can be tasks, stories, features, or epics. Your job is to resolve them to leaf tasks, classify by column, and run a single-phase validation pipeline: **code review + testing** (combined, parallel) -> **board movement**.

Provider rule:

- Resolve `ACTIVE_PROVIDER` from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:

1. Resolve context (`get_validate_context`).
2. Create/activate worktree for session isolation.
3. Move all validatable tasks to Validating (transient state).
4. Only then run the combined code review + testing phase.

If any gate fails, report the failure clearly and stop.

## Step 0: Parse input and resolve context

Split `$ARGUMENTS` by whitespace to extract the list of IDs. Accept the workspace work-item format (e.g. `A-425`, `A-F-125`, `MC-10`, `MC-F-42`) and do not hardcode a single prefix.

If no valid IDs are found, tell the user and stop.

Use a single call:

1. `get_validate_context(ids: [ ...input IDs... ])`
2. Read:
   - `tasks.validatable`: leaf tasks in the Reviewing column (need code review + testing)
   - `tasks.skipped`: tasks not in Reviewing (with `skipReason`)
   - `boardContext`: semantic `columnMap` per board (includes `validating`, `release`, `inProgress` column IDs)
   - `parentItems`: parent summaries with children counts per column
3. If `validatable` is empty, report skips and stop.

Report to the user:

```
Validation pipeline for X tasks:
  - Validating: Y tasks from Reviewing
  - Skipped: W tasks (not in Reviewing)
```

Write a marker file for token tracking:

```bash
echo '{"workItemIds":["<UUID1>","<UUID2>"],"startedAt":"<ISO_TIMESTAMP>","model":"<YOUR_MODEL_ID>","provider":"<YOUR_PROVIDER>","skill":"validate","sessionType":"validate"}' > /tmp/mc-ai-session-marker.json
```

## Step 0.5: Create worktree for session isolation

Before running any validation, isolate changes in a dedicated worktree. This allows multiple `/validate` sessions to run in parallel without conflicts, and leaves the main repo's working directory untouched.

### 0.5a. Detect if already in a worktree

```bash
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
```

**Decision logic:**

- If `git rev-parse` fails entirely -> not a git repo. Set `WORKTREE_PATH` to the current working directory, `CREATED_WORKTREE = false`, and skip to Step 1 (backwards compatibility).
- If `GIT_COMMON_DIR` contains `.git/worktrees/` -> already inside a worktree. Set `WORKTREE_PATH` to `$(git rev-parse --show-toplevel)`, `CREATED_WORKTREE = false`, and skip to Step 1.
- Otherwise -> in the main repository. Proceed to 0.5b.

### 0.5b. Determine branch name

Use the **first input ID** (typically a feature or epic) to derive the branch name:

| Input scope | Branch prefix | Example |
|---|---|---|
| Single epic (`MC-E-XX`) | `validate/epic/` | `validate/epic/MC-E-19-2026-03-06-123456` |
| Single feature (`MC-F-XX`) | `validate/feature/` | `validate/feature/MC-F-42-2026-03-06-123456` |
| Multiple IDs | `validate/` | `validate/MC-F-42-MC-10-2026-03-06-123456` |

Include a timestamp suffix (`YYYY-MM-DD-HHMMSS`) to ensure uniqueness for re-runs.

Full branch name: `<prefix><ID(s)>-<timestamp>` (e.g. `validate/feature/MC-F-42-2026-03-06-123456`)

### 0.5c. Fetch and check for existing remote branch

```bash
git fetch origin
```

Check if a remote branch already exists for this validation session (re-run scenario):

```bash
git branch -r --list "origin/<branch-name>"
```

### 0.5d. Create the worktree

Get the repository root (needed for `.worktrees/` path):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
```

**If an existing remote branch was found** (re-run):

```bash
git worktree add --track -b "<branch-name>" "$REPO_ROOT/.worktrees/<branch-name>" "origin/<branch-name>"
```

**If no existing remote branch** (fresh validation):

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

### 0.5e. Install dependencies in the worktree

The worktree shares `.git` but has its own `node_modules`. Dependencies must be installed:

```bash
cd "$WORKTREE_PATH" && bun install
```

### 0.5f. Confirm to user

```
Worktree created at: $WORKTREE_PATH
Branch: <branch-name> (based on origin/main)
Dependencies installed.
```

**Important**: From this point forward, ALL file operations, test runs, and git commands must use `WORKTREE_PATH` as the working directory.

## Progress Reporting (mandatory)

Report progress in natural language on their own line throughout execution:

```
- Tell the user: Resolviendo tareas y contexto...
- Tell the user: Worktree creado en .worktrees/validate/feature/A-F-XXX — instalando dependencias...
- Tell the user: Moviendo N tasks a Validating...
- Tell the user: Validación: Code Review + Testing — N tasks en paralelo...
- Agent completion example: code-reviewer|A-653|PASS
- Agent completion example: javascript-pro|A-653|PASS (12/12 tests)
- Agent completion example: code-reviewer|A-652|FAIL
- Tell the user: Procesando resultados...
- Tell the user: Committing test files...
- Tell the user: Completando validación — moviendo a Release / In Progress...
- Final success example: Validación completada: X tasks en Release, Y tasks en In Progress
- Warning example: Completado con advertencias
- Failure example: <motivo si falla completamente>
```

Report success clearly on full success, a warning if some tasks had issues, an error if everything failed. Never skip the final outcome summary.

## Step 1: Move all validatable tasks to Validating (transient state)

Before starting any validation work, move ALL validatable tasks to the Validating column. This signals that these tasks are currently being processed by AI.

```
batch_move_work_items(
  workItemIds: [<all validatable task UUIDs>],
  boardColumnId: "<from boardContext.columnMap.validating>",
  setAiProcessing: true
)
```

This is a transient state — tasks will move to Release or In Progress once validation completes.

## Step 2: Combined Code Review + Testing (all tasks in parallel)

For each validatable task, run BOTH code review AND test generation/execution simultaneously. All agents for ALL tasks are launched in a **single message** for maximum parallelism.

### 2a. Identify changed files per task

For each validatable task, use git to find changed files:

```bash
git log --oneline --all --grep="<TASK_ID>" --name-only
```

If no commits reference the task, use `git diff` against the base branch to identify relevant files based on the task's description and domain.

### 2b. Launch ALL agents (review + test) in a single message

For each validatable task, launch BOTH review agents AND a test agent in parallel:

#### Review agents (per task)

| Review aspect | Agent (`subagent_type`) | Model param | When to use |
|---|---|---|---|
| Code quality, patterns, bugs | `feature-dev:code-reviewer` | _(inherit)_ | **Always** |
| Architecture compliance (DDD, Clean Architecture) | `frontend-clean-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When frontend files changed |
| Backend architecture compliance | `backend-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When backend files changed |
| Database query quality | `database-optimizer` | _(inherit)_ | When repository files changed |

#### Test agent (per task)

| Task involves | Agent (`subagent_type`) | Model param |
|---|---|---|
| Frontend files (hooks, components, utils) | `javascript-pro` | _(inherit)_ |
| Backend files (routes, services, repos) | `javascript-pro` | _(inherit)_ |
| E2E tests (if frontend UI changes) | `frontend-developer` | _(inherit)_ |

**Subagent prompt template for review:**

```
You are reviewing work item {TASK_ID}: "{TITLE}"

## Working Directory

All work MUST happen inside the worktree at: {WORKTREE_PATH}

Use these paths for checks and file operations:
- Frontend root: {WORKTREE_PATH}/frontend
- Backend root: {WORKTREE_PATH}/backend

## Task Details
- **Type**: {TYPE} | **Priority**: {PRIORITY}
- **Description**: {DESCRIPTION}
- **Definition of Done**: {DOD or "Not specified"}

## Changed Files
{LIST_OF_FILES}

## Instructions

1. Read each changed file thoroughly.
2. Check against the Definition of Done criteria.
3. Verify architecture compliance:
   - DDD: domain types -> application hooks -> presentation components/containers
   - Clean Architecture: no classes, functional only, .tsx files purely presentational
   - Follow project conventions from CLAUDE.md
4. Check code quality: TypeScript correctness (no `any`), unused imports, naming, error handling, security.
5. Run automated checks:
   - `cd {WORKTREE_PATH}/frontend && bun run type-check` (if frontend)
   - `cd {WORKTREE_PATH}/frontend && bun run lint` (if frontend)
   - `cd {WORKTREE_PATH}/backend && bun run type-check` (if backend)
6. Report:
   - **result**: "pass" or "fail"
   - **summary**: 1-3 sentence summary
   - **issues**: Array of issue descriptions (empty if pass)
   - **reviewedFiles**: Array of file paths reviewed
```

**Subagent prompt template for testing:**

```
You are generating tests for work item {TASK_ID}: "{TITLE}"

## Working Directory

All work MUST happen inside the worktree at: {WORKTREE_PATH}

Use these paths for checks and file operations:
- Frontend root: {WORKTREE_PATH}/frontend
- Backend root: {WORKTREE_PATH}/backend

## Changed Files
{LIST_OF_FILES_WITH_TEST_TYPE}

## Instructions

1. For each testable file, create a test file NEXT to the source file:
   - Naming: `<filename>.test.ts` or `<filename>.test.tsx`
   - Use `bun:test` imports: `describe`, `it`, `expect`, `mock`, `beforeEach`
   - Follow AAA pattern (Arrange, Act, Assert)
   - Test happy path AND edge cases
   - Mock external dependencies (API calls, database)

2. For React hooks: use `@testing-library/react` `renderHook` with fresh `QueryClient` per test.
   - Do NOT mock API calls with spyOn/mock.module — use `queryClient.setQueryData` to pre-populate cache.
   - Use `waitFor` with timeout >= 3000ms.

3. For components: use `@testing-library/react` `render` + `screen` queries.

4. Run each test file **from the worktree**:
   ```bash
   cd {WORKTREE_PATH} && bun test <path-to-test-file>
   ```

- If a test fails due to test bug, fix and retry (max 3 attempts).
- If a test fails due to production bug, document it but do NOT fix production code.

1. File testability rules:

   | File Pattern | Test Type |
   |---|---|
   | `application/hooks/use-*.ts` | Hook unit test |
   | `presentation/components/*.tsx` | Component test |
   | `lib/*.ts` (not api client) | Unit test |
   | `routes/*.ts` | Integration test |
   | `repositories/*.ts` | Repository test |
   | `domain/types.ts`, `enums.ts` | Skip |
   | `presentation/containers/*.tsx` | Skip (tested via hook + component) |
   | `lib/api/*.ts` | Skip (thin wrappers) |

2. Report:
   - **passed**: number of tests passed
   - **failed**: number of tests failed
   - **testFiles**: array of test file paths created
   - **productionBugs**: array of any bugs found in production code

```

**CRITICAL**: Launch ALL review agents AND ALL test agents for ALL tasks in a **single message** with multiple `Task` tool calls for true parallel execution.

### 2c. Process combined results per task

After all agents complete, evaluate each task by combining its review results and test results:

#### PASS condition (ALL must be true):
- ALL review agents report `result: "pass"`
- ALL tests pass (or task has no testable files)

#### FAIL condition (ANY triggers failure):
- ANY review agent reports `result: "fail"`
- ANY test fails due to production bug

#### For PASS tasks:

1. Commit test files in the worktree:
   ```bash
   cd "$WORKTREE_PATH" && git add <test-file-1> <test-file-2> ...
   cd "$WORKTREE_PATH" && git commit -m "$(cat <<'EOF'
   test(A-XXX): Add unit/integration tests
   EOF
   )"
   ```

1. Call `complete_validation` to move to **Release**:

   ```
   complete_validation(
     workItemId: "<UUID>",
     releaseColumnId: "<from boardContext.columnMap.release>",
     testResults: { passed, failed, testFiles },
     model: "<MODEL_USED_BY_SUBAGENT>",
     provider: ACTIVE_PROVIDER,
     totalTokens: <accumulated tokens for this task>,
     durationMs: <accumulated duration>,
     taskId: "A-XXX"
   )
   ```

   **Important**: Use `releaseColumnId` and pass `boardContext.columnMap.release` (the Release column ID). Do **not** pass the transient `validating` column here. The tool still accepts the legacy `validatingColumnId` alias for backward compatibility, but `releaseColumnId` is the canonical flow.

#### For FAIL tasks

Call `complete_validation_fail` to move to **In Progress**:

```
complete_validation_fail(
  workItemId: "<UUID>",
  inProgressColumnId: "<from boardContext.columnMap.inProgress>",
  diagnosis: "## Validation Failed\n\n### Code Review Issues\n<issues from review agents, if any>\n\n### Test Failures\n<test failures, if any>",
  model: "<MODEL>",
  provider: ACTIVE_PROVIDER,
  totalTokens: <tokens>,
  durationMs: <duration>,
  taskId: "A-XXX"
)
```

Parse `<usage>` tags from each subagent output for token tracking.

Report per task:

```
Validation results:
  - A-XX: Review PASS, Tests 12/12 PASS -> Release (~Nk tokens)
  - A-YY: Review FAIL (architecture issues) -> In Progress
  - A-ZZ: Review PASS, Tests 8/10 FAIL (production bug) -> In Progress
```

**Model rule**: Do NOT translate agent type into a fixed model. Record the actual model that ran; by default this is the inherited session model selected by the user.

### 2d. Save validation memory

After the validation result is determined for each task, call `workitem_save` to record the validation context for future reference. This is best-effort -- if the call fails, log a warning and continue.

#### For PASS tasks

```
workitem_save(
  topicKey: "<taskId-slug>-validation",          // e.g. "a-t-42-validation"
  title: "Validation passed: <brief description of what was validated>",
  workItemId: "<UUID>",
  taskId: "<TASK-ID>",                           // e.g. "A-T-42"
  workItemType: "<task|story|feature|epic>",
  action: "validated",
  description: "<summary of what was validated -- code review findings, test results, architecture compliance>",
  rationale: "<why the implementation met quality standards -- e.g. clean separation of concerns, all tests green, no type errors>",
  affectedFiles: ["<list of files that were reviewed>"],
  decisions: ["<notable patterns or approaches that were validated as correct>"],
  learnings: ["<positive patterns worth repeating in future implementations>"],
  projectId: "<project UUID from context>"
)
```

#### For FAIL tasks

```
workitem_save(
  topicKey: "<taskId-slug>-validation",          // e.g. "a-t-42-validation"
  title: "Validation failed: <brief description of issues found>",
  workItemId: "<UUID>",
  taskId: "<TASK-ID>",                           // e.g. "A-T-42"
  workItemType: "<task|story|feature|epic>",
  action: "validated",
  description: "<what failed -- code review issues, test failures, architecture violations>",
  rationale: "<why the implementation didn't meet standards -- e.g. missing error handling, DDD violation, type errors>",
  affectedFiles: ["<list of files that were reviewed>"],
  decisions: ["<what needs to change to pass validation>"],
  learnings: ["<what to avoid in future implementations>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the review and test agent outputs. The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-validation`.

## Step 3: Parent promotion

After all tasks are processed, check `parentItems` from Step 0:

For each parent:

- Re-resolve children status: `resolve_work_items(ids: [parentId], includeLeafTasks: true)`
- If ALL children are in Release or Done columns -> move parent to Release:
  `move_work_item(parentId, releaseColumnId)`
- If SOME children failed -> report which children block the parent.

## Step 4: Summary report

Present a final summary:

```
## Validation Summary

**Input**: N work items | **Resolved tasks**: X
**Worktree**: <branch-name> (or "main repo" if no worktree created)
**Validated**: Y tasks (review + testing combined)
**Completed**: C tasks moved to Release
**Failed**: F tasks moved to In Progress

### Results

| Task | Title | Review | Tests | Final Status |
|------|-------|--------|-------|--------------|
| A-XX | "Title" | PASS | 12/12 | Release |
| A-YY | "Title" | FAIL | - | In Progress |
| A-ZZ | "Title" | PASS | 8/10 FAIL | In Progress |

### Completed tasks (Release)
- **A-XX**: [Summary] — Release (awaiting release/documentation)
  - Tests: 12 passed (3 files committed)

### Failed tasks (In Progress)
- **A-YY**: Review failed — [issues] — moved to In Progress
- **A-ZZ**: Tests failed — [production bugs] — moved to In Progress

### Skipped tasks (if any)
- **A-WW**: Column 'Backlog' is not Reviewing

### Parent items
- **A-F-XX**: 3/4 children in Release (A-YY blocks promotion)

### Next steps for you
- [ ] Review tasks in Release column and run /document only if release documentation is required
- [ ] Fix tasks in In Progress column and move back to Reviewing for re-validation
```

## Error Handling

### Worktree creation failure

If `git worktree add` fails:

- Report the error to the user
- If in the main repo, continue without worktree (backwards compatibility)
- If already in a worktree, report and stop

### Failure routing

When a task fails validation:

- **If `boardContext.columnMap.inProgress` exists**: Use `complete_validation_fail` to move to In Progress with structured diagnosis.
- **If `boardContext.columnMap.inProgress` is null**: Fall back to legacy flow (`move_work_item` to In Progress).

### Failures do NOT block other tasks

If a task fails review or testing, it is moved to In Progress but all other tasks continue validation normally.

### No testable files

If a task has no testable files (only types, configs, etc.):

- Skip test generation for that task
- Set `testResults: { passed: 0, failed: 0, testFiles: [] }`
- Task can still pass based on review results alone

### Token tracking

Per subagent, parse the `<usage>` tag:

```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Accumulate per task across all agents (review + test). Use accumulated totals in `complete_validation` or `complete_validation_fail`.

If `<usage>` tag is missing, use `durationMs` from marker file timestamps and set `totalTokens` to 0.
