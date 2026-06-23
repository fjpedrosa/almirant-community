---
name: fix
description: Use when one or more work items failed `/validate`, have unresolved review/test issues, or need corrective implementation before re-running validation.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Fix Skill

You are given **one or more work item IDs** (for example `A-425`, `MC-10`, `MC-F-42`). They may be tasks, stories, features, or epics. Your job is to collect the failure context from the last validation attempt, open a dedicated worktree for the corrective pass, implement the missing fixes, re-run validation on the corrected tasks, and finish by creating or updating the PR for that fix branch.

Provider rule:

- Resolve `ACTIVE_PROVIDER` from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:

1. Resolve leaf tasks and gather failure evidence.
2. Open a dedicated worktree/branch for the fix session.
3. Normalize fixable tasks back to `Backlog` before corrective implementation.
4. Only then run the implementation flow inside that worktree.
5. Re-resolve tasks and re-run validation in the **same worktree** when tasks are ready.
6. Create or update the PR for the fix branch.
7. Only then clean up and report the final outcome.

If any gate fails, report the failure clearly and stop.
Never start coding, testing, or re-validating outside the dedicated worktree, or before you have a per-task summary of the failure reasons.

## Progress Reporting (mandatory)

Report progress in natural language on their own line throughout execution:

```text
- Tell the user: Resolviendo tareas fallidas y su contexto...
- Tell the user: Abriendo worktree dedicado fix/MC-123-2026-03-11-143500 en .worktrees/fix/MC-123-2026-03-11-143500...
- Tell the user: Normalizando tareas a Backlog para relanzar implement...
- Tell the user: Ejecutando implement correctivo para 2 tareas...
- Tell the user: Re-lanzando validate sobre 2 tareas corregidas...
- Tell the user: Creando o actualizando la PR del fix...
- Final success example: Correccion, revalidacion y PR completadas
- Warning example: Algunas tareas no quedaron listas para validate o PR
- Failure example: <motivo si falla completamente>
```

Report success clearly on full success, a warning if some tasks were skipped, could not be revalidated, or the PR could not be created because there were no new commits, an error if the flow fails completely.

## Step 0: Parse input and resolve leaf tasks

Split `$ARGUMENTS` by whitespace to extract the list of IDs. Accept workspace task IDs (`A-*`, `MC-*`) and UUIDs.

If no valid IDs are found, tell the user and stop.

Use:

1. `resolve_work_items(ids: [ ...input IDs... ], includeLeafTasks: true)`
2. Read:
   - `items`: resolved leaf tasks
   - `notFound`: unresolved IDs

Classify each resolved leaf task:

- **Fixable** when at least one of these is true:
  - `metadata.lastReviewResult === "fail"`
  - `metadata.lastTestResult === "fail"`
  - `metadata.lastReviewIssues` is non-empty
  - `metadata.testIssues` is non-empty
  - `metadata.lastError` is present
  - The task is currently in `In Progress` and was explicitly requested
- **Validate-only** when it is in `Reviewing` or `Release` with no failure evidence
- **Skipped** when it is in `Done`/`Validating` with no explicit failure evidence, or it cannot be safely classified

If no tasks are fixable, report the reason and stop. If tasks are only validate-ready, tell the user to use `/validate` instead.

Report to the user:

```
Fix pipeline for X tasks:
  - Fixable: Y
  - Validate-only: Z
  - Skipped / not found: W
```

Write a marker file for token tracking:

```bash
echo '{"workItemIds":["<UUID1>","<UUID2>"],"startedAt":"<ISO_TIMESTAMP>","model":"<YOUR_MODEL_ID>","provider":"<YOUR_PROVIDER>","skill":"fix","sessionType":"fix"}' > /tmp/mc-ai-session-marker.json
```

## Step 1: Gather failure evidence per task

For each **fixable** task, collect the most recent failure context before touching code.

### 1a. Read stored metadata

Extract from `metadata` when present:

- `lastReviewResult`
- `lastReviewSummary`
- `lastReviewIssues`
- `lastReviewedFiles`
- `lastTestResult`
- `testIssues`
- `testResults`
- `lastError`
- `userActions`
- `pullRequest.branch` / `pullRequest.url`

### 1b. Fall back to recent timeline if metadata is incomplete

Use:

- `get_work_item_events(workItemId, limit: 20)`
- `list_work_item_comments(workItemId)` when comments may contain review or manual QA feedback

Use recent `updated`, `comment`, `moved`, and `ai_session` entries to infer:

- whether the failure happened during review or testing
- which files or behaviors were involved
- whether the task was previously sent back from `Reviewing`/`Release` to `In Progress`

### 1c. Produce a Fix Brief

Build a concise Fix Brief per task:

```markdown
- Task: MC-123 — Title
- Failure source: review | testing | implement | unknown
- Blocking issues:
  - ...
  - ...
- Suspect files / reviewed files:
  - ...
- Missing behavior to verify:
  - ...
```

If a task has no usable failure evidence, keep it fixable only when the user explicitly asked for it. Mark it as `unknown-cause` and call that out in the brief.

### 1d. Save fix diagnosis memory

For each fixable task with a completed Fix Brief, call `workitem_save` to record the diagnosis context. This is best-effort -- if the call fails, log a warning and continue.

```
workitem_save(
  topicKey: "<taskId-slug>-fix-diagnosis",     // e.g. "mc-t-42-fix-diagnosis"
  title: "Fix diagnosis: <brief description of the failure>",
  workItemId: "<UUID>",
  taskId: "<TASK-ID>",                         // e.g. "MC-T-42"
  workItemType: "<task|story|feature|epic>",
  action: "fixed",
  description: "<root cause analysis -- what failed and why, 2-3 sentences>",
  rationale: "<the suspected cause and the fix strategy>",
  affectedFiles: ["<suspect files identified in the Fix Brief>"],
  decisions: ["<what approach was chosen to fix it>"],
  learnings: ["<what led to the failure -- patterns or mistakes to watch for>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the Fix Brief produced in Step 1c. The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-fix-diagnosis`.

## Step 2: Open a dedicated worktree before any code changes

All corrective implementation and re-validation must happen in the same dedicated branch/worktree. Default behavior is to open a fresh worktree for the chosen branch before any code changes. The only reuse allowed is when that exact branch is already mounted in an existing dedicated worktree for the same fix.

### 2a. Choose the target branch

Use the **first fixable task** as the primary task.

If the Fix Brief or task metadata includes `pullRequest.branch`:

1. `git fetch origin`
2. If `origin/<pullRequest.branch>` exists, set `TARGET_BRANCH="<pullRequest.branch>"`.
3. Otherwise fall back to a fresh fix branch.

If there is no reusable branch, create:

`fix/<PRIMARY_ID>-<timestamp>`

Example:

- `fix/MC-568-2026-03-11-143500`
- `fix/A-425-2026-03-11-143500`

Set `TARGET_BRANCH` to that value.

### 2b. Compute repository context and worktree path

```bash
COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
CURRENT_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
REPO_ROOT=$(cd "$COMMON_GIT_DIR/.." && pwd)
WORKTREE_PATH="$REPO_ROOT/.worktrees/$TARGET_BRANCH"
```

Decision logic:

- If any git command above fails, Report: Failure summary: Git repository context unavailable; cannot open dedicated fix worktree. and stop.
- If `CURRENT_TOPLEVEL` equals `WORKTREE_PATH` and `CURRENT_BRANCH` equals `TARGET_BRANCH`, keep using the current worktree and set `CREATED_WORKTREE=false`.
- Otherwise, open a dedicated worktree for `TARGET_BRANCH`. Never do corrective coding from the main repo checkout.

### 2c. Create or reuse the dedicated worktree

If `origin/$TARGET_BRANCH` exists, create the worktree from that remote branch:

```bash
git fetch origin
git worktree add --track -b "$TARGET_BRANCH" "$WORKTREE_PATH" "origin/$TARGET_BRANCH"
```

Otherwise create it from `origin/main`:

```bash
git fetch origin
git worktree add "$WORKTREE_PATH" -b "$TARGET_BRANCH" origin/main
```

Then:

- `CREATED_WORKTREE=true`
- `cd "$WORKTREE_PATH" && bun install`

If `git worktree add` fails:

- If the target branch is already checked out in another **dedicated worktree**, inspect `git worktree list`, locate the matching path, set `WORKTREE_PATH` to that path, and continue with `CREATED_WORKTREE=false`.
- If the target branch is checked out in the **main repo checkout**, create a fresh timestamped `fix/<PRIMARY_ID>-<timestamp>` branch from that branch and retry, because this skill must not edit the main repo checkout directly.
- If the failure is due to a stale/incomplete worktree from a previous run, remove the stale worktree and retry once.
- Otherwise report the failure clearly and stop.

From this point forward, **all** file operations, tests, and git commands must use `WORKTREE_PATH`.

## Step 3: Normalize fixable tasks back to Backlog

`/implement` only accepts pending tasks in `Backlog`, so failed validation tasks must be normalized first.

Use:

1. `get_board_context()` (or `get_board_context(projectId)` if needed)
2. The resolved task data from Step 0

For each fixable task:

- If it is already in `Backlog`, keep it there.
- If it is in `In Progress`, `Reviewing`, or `Release`, move it back to the board `backlog` column.
- If the board does not expose a `backlog` column in `columnMap`, report an error for that board and skip those tasks.

Prefer `batch_move_work_items` per board when multiple tasks share the same board.

Report:

```
Tasks normalized for corrective implementation:
  - MC-123 -> Backlog
  - MC-124 -> already in Backlog
```

## Step 4: Run corrective implementation

Now run the **implementation flow** for the normalized task IDs by following `.claude/skills/implement/SKILL.md`.

Additional rules for this fix pass:

- Stay in `WORKTREE_PATH`. Do not create or switch to a different worktree.
- Treat every Fix Brief issue as a mandatory acceptance criterion.
- Before changing code, reproduce or precisely localize the failing behavior when practical.
- If the previous failure was from review, address every listed review issue or explicitly explain why it no longer applies.
- If the previous failure was from tests, add or update tests that would catch the regression when practical.
- If multiple tasks fail for the same root cause, fix the shared cause once and report which tasks were unblocked by it.
- Keep the implementation scope focused on making the failed tasks pass validation. Do not broaden the change without a concrete reason.
- The fix flow owns the final PR outcome. Do not end the session assuming `validate` already handled the branch PR correctly.

At the end of the implementation pass, produce a per-task resolution summary:

```markdown
- MC-123
  - Resolved: ...
  - Tests added/updated: ...
  - Remaining risks: ...
```

If a task still cannot be fixed, leave it out of re-validation and report the blocker.

### 4-bis. Save fix resolution memory

For each task that was **successfully corrected** in the implementation pass, call `workitem_save` to record the resolution context. This is best-effort -- if the call fails, log a warning and continue.

```
workitem_save(
  topicKey: "<taskId-slug>-fix-resolution",    // e.g. "mc-t-42-fix-resolution"
  title: "Fix applied: <brief description of the fix>",
  workItemId: "<UUID>",
  taskId: "<TASK-ID>",                         // e.g. "MC-T-42"
  workItemType: "<task|story|feature|epic>",
  action: "fixed",
  description: "<what was actually changed to fix the issue -- 2-3 sentences>",
  rationale: "<why this specific fix was chosen over alternatives>",
  affectedFiles: ["<files actually modified during the fix>"],
  decisions: ["<key decisions made during the fix>"],
  learnings: ["<how to prevent this type of failure in the future>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the per-task resolution summary produced at the end of Step 4. The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-fix-resolution`.

## Step 5: Select tasks ready for re-validation

After the corrective implementation finishes:

1. Run `resolve_work_items(ids: [ ...original input IDs... ], includeLeafTasks: true)` again.
2. Build the re-validation set:
   - **Ready**: tasks now in `Reviewing` or `Release`
   - **Blocked**: tasks still in `Backlog` / `In Progress`
   - **Skipped**: tasks moved to `Done` / `Validating`, or tasks that failed implementation

If no tasks are ready, report a warning clearly, report the blocked tasks, skip Step 6, and continue to Step 7 only if the branch contains corrective commits or an existing PR still needs to be refreshed. Otherwise stop after reporting the blocker state.

Report:

```
Ready for validate: MC-123, MC-124
Blocked after fix: MC-125 (still in In Progress)
```

## Step 6: Re-run validation in the same worktree

Run the validation flow for the **ready** task IDs by following `.claude/skills/validate/SKILL.md`.

If no tasks are ready, skip this step and continue to Step 7.

Critical constraints:

- Keep using the same `WORKTREE_PATH` and branch chosen in Step 2.
- Do **not** rebase onto a different branch before validating.
- If `.claude/skills/validate/SKILL.md` reaches its worktree gate while already inside `WORKTREE_PATH`, keep the current worktree and continue.
- If validation commits new test or documentation changes, keep those commits on the same branch.
- Do not treat any PR action inside `validate` as the final PR outcome for this skill. Step 7 must always create or refresh the branch PR before the fix session ends.

## Step 7: Create or update the PR for the fix

Run the PR flow from the **same `WORKTREE_PATH`** by following `.claude/skills/pr/SKILL.md`.

Rules:

- Pass the primary task ID when available so the PR title/body links back to the correct work item.
- If a PR already exists for `TARGET_BRANCH`, update it instead of creating a second PR.
- If no PR exists, create it from the current branch state.
- Capture the final PR URL/number and include it in the final summary.
- If there are no commits on the branch relative to `main`, report a warning clearly, explain that no PR could be created, and continue to cleanup/reporting.

The fix skill is not complete until this PR step has either succeeded or explicitly reported the `no commits` warning.

## Step 8: Cleanup and final summary

If this skill created the worktree in Step 2 and the validation/PR flows did not remove it:

1. Return to the repo root.
2. Remove the worktree with `git worktree remove ... --force`.
3. Delete the local branch only if the remote branch or PR already exists and the worktree was created solely for this run.

Present a final summary:

```text
## Fix Summary

Input: N work items
Fixable: X
Corrected: Y
Revalidated: Z
Blocked: W

### Results
- MC-123: fixed -> validate passed
- MC-124: fixed -> validate failed again (see new issues)
- MC-125: not fixed (blocked by ...)

### Branch / worktree
- Branch: <branch-name>
- Worktree: <path>

### Pull Request
- PR: <created|updated|not-created> <url if available>

### Next steps
- Review any tasks still blocked
- Review and merge the PR once validation results are acceptable
```

If all corrected tasks passed validation and the PR step succeeded, report success clearly.
If some corrected tasks could not be revalidated, or no PR could be created because there were no new commits, report a warning clearly.
