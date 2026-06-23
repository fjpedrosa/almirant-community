---
name: runner-fix-dod
description: Remote runner workflow for Backlog work items marked with metadata.dod_incompleted=true. Repairs the previous Definition of Done failure using metadata.dod_report, then sends the item back to review.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
---

# Runner Fix DoD Skill

Use this skill when an Almirant work item was moved back to **Backlog** by the `dod-review` gate with `metadata.dod_incompleted=true` and a saved `metadata.dod_report`.

This is NOT a generic implementation workflow. It is a remediation workflow: fix exactly what failed the Definition of Done review, preserve working implementation, and return the task to Review.

The orchestrator **always** delegates fixes to specialist subagents — it does NOT fix code directly. MAX 5 subagents run concurrently to prevent tmpfs exhaustion.

## Runner assumptions

- The runner container already has the repository checked out on the correct branch.
- The draft PR already exists. Do NOT create a new branch or PR.
- The PR URL is available in `ALMIRANT_PR_URL`; include it in the final summary.
- Git credentials are configured. Commit locally per batch and push **once** after all batches complete.
- Read `ACTIVE_PROVIDER` from `ALMIRANT_PROVIDER` for MCP calls that accept `provider`/`aiProvider`.

## Non-negotiable gates

1. Parse `$ARGUMENTS` and call `get_implement_context(ids: [...])`.
2. Accept only valid leaf tasks that are in **Backlog** and have `metadata.dod_incompleted=true`.
3. Require a non-empty `metadata.dod_report` for each accepted task. If missing for a task, skip that task and explain why — do not stop the whole run.
4. Move all accepted tasks to **In Progress** with `batch_move_work_items(..., setAiProcessing: true, aiProvider: ACTIVE_PROVIDER)` before any code changes.
5. Fix only the failures described in the per-task DoD report. Do not broaden scope or rewrite unrelated code.
6. Commit locally per batch. Push **once** after all batches complete.
7. Complete each successfully fixed task with `complete_ai_task`; this moves it to Review and clears transient AI processing / DoD failure metadata.
8. If a task requires a **human, operational, or external-validator action** that cannot be completed safely by the runner, do **not** fail the whole job and do **not** call `complete_ai_task` for that task. Mark it with `metadata.dod_human_action_required=true`, `metadata.dod_human_action="<specific human action>"`, and `metadata.dod_auto_remediation_blocked=true`. For external validators, also set `metadata.dod_external_validation_required=true`, `metadata.dod_external_validation_tools=[...]`, and `metadata.dod_external_validation_reason="<specific validation>"`.

If all tasks are invalid, do not edit files.

## Step 1: Parse input and resolve context

Split `$ARGUMENTS` by whitespace to extract the list of IDs. Accept any workspace work-item format (`A-425`, `A-F-125`, `MC-10`, etc.).

Use a single call:
1. `get_implement_context(ids: [ ...input IDs... ])`
2. Read:
   - `tasks.valid`: pending leaf tasks ready to execute
   - `tasks.skipped`: tasks skipped with `skipReason`
   - `boardContext`: semantic `columnMap` per board

If `tasks.valid` is empty, report skips and stop.

## Step 2: Validate tasks

For each resolved task:

- **Valid**: column is "Backlog" (case-insensitive) AND `metadata.dod_incompleted === true` AND `metadata.dod_report` is non-empty.
- **Skip with warning**: column is not Backlog, OR `dod_incompleted` is not true.
- **Skip as human action required**: `metadata.dod_human_action_required === true`, `metadata.dod_human_review_required === true`, `metadata.dod_auto_remediation_blocked === true`, or `metadata.dod_external_validation_required === true`. Include the action/reason in the summary.
- **Skip with error**: `metadata.dod_report` is missing or empty — log `SKIP <TASK-ID>: no dod_report found`.

**Stale In Progress** (recoverable): "In Progress" tasks where `isAiProcessing: true`, no linked commits, and no recent activity in the last 30 minutes are treated as abandoned. Move them back to Backlog and include them. Log: `Recovered N stale In Progress tasks`.

Report: `Found X tasks to fix (Y skipped: [reasons])`

If ALL tasks are skipped/invalid, stop.

## Human/operational action policy

Some DoD reports describe checks that are not code fixes. Handle them explicitly instead of letting the job become `incomplete`:

- **Database migrations / db push**: NEVER run `db:push`, `db:migrate`, or equivalent against production. If the report asks to apply a migration to a real environment, validate the generated migration internally when possible, then mark the task as human action required with the exact environment/action needed.
- **Legal review**: If an AI specialist review is sufficient, delegate to `legal-advisor`. If the criterion requires accountable human sign-off, mark `dod_human_review_required=true` and `dod_human_action_required=true` with the concrete sign-off needed.
- **Playwright/browser validation**: If `ENABLE_BROWSER=true` and Playwright MCP is available, use it. If the environment cannot run the browser validation, mark human action required with the missing environment/runtime requirement instead of failing the full job.
- **External validators** (Google Rich Results Test, Schema.org validator, Lighthouse/PageSpeed, axe, social card debuggers, payment/provider sandboxes, production-only preview checks): if the runner cannot execute the validator inside the job, mark the task with the external-validation metadata below so the board shows a dedicated validator badge.
- **Other external actions** (secrets, credentials, third-party approval, production-only verification): mark human action required with a clear sentence the card tooltip can display.

When marking human action required:

```
update_work_item(
  id: "<UUID>",
  metadata: {
    dod_human_action_required: true,
    dod_human_action: "<specific action the human must take>",
    dod_auto_remediation_blocked: true,
    // set these when a third-party/manual validator is required
    dod_external_validation_required: true,
    dod_external_validation_tools: ["<validator name>"],
    dod_external_validation_reason: "<specific validation that must be performed>",
    // also set when the action is accountable review/sign-off
    dod_human_review_required: true
  }
)
```

If the task was already moved to In Progress for this run, move it back to Backlog after setting metadata.

## Step 3: Use pre-resolved board structure

Use `boardContext[].columnMap` from Step 1.
No regex matching on column names. If any required column is missing (`backlog`, `inProgress`, `review`), report the board and stop for those tasks.

## Step 4: Resolve metadata once

Before starting batches:

1. **Coding agent** (`CODING_AGENT`): Read `ALMIRANT_CODING_AGENT` env var. Default to `"claude-code"`.
2. **Current user ID** (`CURRENT_USER_ID`): Call `get_current_user()` and cache the returned ID. If the call fails, set to `undefined`.

Cache both — reuse for every `complete_ai_task` call.

## Step 5: Move all valid tasks to In Progress

```
batch_move_work_items(allValidTaskIds, inProgressColumnId, setAiProcessing: true, aiProvider: ACTIVE_PROVIDER)
```

## Step 6: Execute fix batches (parallel, MAX_CONCURRENT_AGENTS = 5)

**MAX_CONCURRENT_AGENTS = 5** — never launch more than 5 subagents simultaneously.

DoD fixes are independent (no wave dependencies). Process all valid tasks in flat batches:

1. Split all valid tasks into groups of MAX_CONCURRENT_AGENTS (last group may be smaller).
2. For each batch:
   a. Report batch launch in prose (batch number, agent, task ID, title).
   b. Launch ALL batch tasks in a **single message** with multiple `Task` tool calls, `run_in_background: true`.
   c. Wait for all subagents in the batch to complete.
   d. Commit changes for successful tasks (local only — NO push yet) — Step 7.
   e. Update board and record AI sessions — Step 8.
   f. Report batch result: `Batch N/M: X/Y fixed`
3. After all batches, push once — Step 9.

**CRITICAL**: Each batch MUST be launched in a single message with multiple `Task` tool calls for true parallel execution.

### Agent selection per task

For each task, determine `subagent_type` in this priority order:

1. **Primary**: `metadata.dod_suggested_agents[0]` (set by `dod-review`). Use this when present.
2. **Fallback**: infer from the failing task's type, title, and the files named in `metadata.dod_report`:

| Task/files involve | Agent |
|---|---|
| Frontend components (`.tsx`), React UI, presentational | `frontend-developer` |
| Frontend hooks, state management, React Query | `frontend-developer` |
| Clean Architecture compliance, DDD layer separation | `frontend-clean-architect` |
| Backend routes, Elysia endpoints, middleware | `backend-architect` |
| Database schema, Drizzle queries, repositories | `database-architect` |
| Pure TypeScript logic, utilities, transformers | `javascript-pro` |
| JSDoc, inline comments, lint-only fixes | `javascript-pro` |
| API documentation, README, markdown docs | `api-documenter` |
| UI/UX, layout, design system | `ui-ux-designer` |

### Subagent prompt template

```
You are fixing work item {TASK_ID}: "{TITLE}" — it previously FAILED a Definition of Done review and was returned to Backlog.

## Task Details
- **Type**: {TYPE} | **Priority**: {PRIORITY}
- **Description**: {DESCRIPTION}
- **Definition of Done**: {DOD or "Not specified"}

## Working Directory

All work MUST happen in the current working directory (already set up by the runner).

## IMPORTANT: Do NOT commit or push

The orchestrator handles all git operations (commit, push) after your work is done. Do NOT run git add, git commit, or git push. Just fix, verify, and report.

## Previous Definition of Done Review

This task previously FAILED DoD review and was returned to Backlog.

- dod_incompleted: true
- dod_reviewed_at: {DOD_REVIEWED_AT or "unknown"}
- dod_report:

{DOD_REPORT}

## Instructions

1. **Read the fix recipe carefully.** The failing criteria, files to touch, specific changes required, and verification steps are all described above. Follow them exactly.
2. **Fix only the described failures.** Do not broaden scope, refactor unrelated code, or make speculative improvements.
3. **Run the verification steps** listed in the fix recipe to confirm the fix is complete.
4. **Report**: list files changed, what was fixed per criterion, and verification outcome. Then provide these **categorized outcome sections** (exact headers):

   ### Deploy Checklist
   Manual steps needed before/during production deployment. If none, write "No deploy actions needed."

   ### Validation Checks
   Concrete verification steps to confirm the fix works. If none, write "No validation checks needed."

   ### Documentation Notes
   What aspects need documentation. If none, write "No documentation needed."
```

## Step 7: Commit batch changes (local only — NO push)

After ALL subagents in a batch complete, the orchestrator commits changes locally.

For each successfully completed task in the batch:

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
   If empty: log `No changes to commit for <TASK-ID>, skipping.` and continue. **Do NOT run `git commit`.**

2. **Create commit**:
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(<TASK-ID>): DoD remediation — {brief description of what was fixed}
   EOF
   )"
   ```
   **NEVER use `--allow-empty`**.

## Step 8: Update board and record AI sessions

For each subagent result in the batch:

**Parse the `<usage>` tag** from the subagent output:
```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```
Extract `total_tokens` and `duration_ms`. If the tag is missing, compute `durationMs` from launch time to now and set `totalTokens` to 0.

**Parse categorized outcomes** from the subagent report:
- `deployChecklist`: content under "### Deploy Checklist" (or empty string)
- `validationChecks`: content under "### Validation Checks" (or empty string)
- `documentationNotes`: content under "### Documentation Notes" (or empty string)

**If SUCCESS**, call `complete_ai_task`:
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
This atomically moves the task to Reviewing, clears `isAiProcessing` and `dod_incompleted`, and records the AI session.

**If FAILED** (subagent errored or reported it could not fix the criteria):
- `move_work_item(workItemId, backlogColumnId)`
- `update_work_item(id, metadata: { lastError: "<brief reason for failure>" })`

**If HUMAN ACTION REQUIRED**:
- `move_work_item(workItemId, backlogColumnId)` when the task was moved to In Progress.
- `update_work_item(id, metadata: { dod_human_action_required: true, dod_human_action: "<specific action>", dod_auto_remediation_blocked: true })`
- If the action is an external validator, include `dod_external_validation_required: true`, `dod_external_validation_tools: ["<validator name>"]`, and `dod_external_validation_reason: "<specific validation>"`.
- Do **not** call `complete_ai_task` for that task.

Report batch progress:
```
Batch N/M complete: X/Y fixed
  - A-XX: "Title" — fixed -> Reviewing (~Nk tokens)
  - A-YY: "Title" — failed: [brief reason] -> Backlog
```

## Step 9: Push all changes (after ALL batches complete)

1. Check for commits to push:
   ```bash
   git log origin/$(git branch --show-current)..HEAD --oneline
   ```
   If no output, report "No changes were made" and proceed to summary.

2. Push:
   ```bash
   git push
   ```
   If push fails, retry once. If still failing, log that push failed — the orphan recovery process will push later.

3. **Link commits to Almirant** (MANDATORY):
   For each successfully fixed task:
   ```
   link_commit_to_work_item(
     workItemId: "<UUID>",
     sha: "<commit SHA>",
     message: "<commit message>",
     branch: "<current branch name>"
   )
   ```
   If the call fails, log the failure and continue.

## Step 10: Summary report

**CRITICAL**: The runner captures your **last text output** as the PR description body. The `## Summary` block MUST be the absolute last thing you output. Do NOT write any text after it.

**DO NOT translate the heading `## Summary`**. Always use `## Summary` in English.

```
## Summary

**Total**: N | **Fixed**: X | **Failed**: Y | **Skipped**: Z

| Task | Title | Status | Commit |
|------|-------|--------|--------|
| A-XX | Title | :white_check_mark: Fixed | `abc1234` |
| A-YY | Title | :x: Failed | — |
| A-ZZ | Title | :fast_forward: Skipped (no dod_report) | — |

### :hammer_and_wrench: Fixes Applied

- **A-XX**: [What DoD failures were remediated]
  `path/to/file.ts` · `path/to/file.tsx`

### :x: Failed (if any)
- **A-ZZ**: [Error or reason]

### :link: Branch & PR
Branch: `<current branch name>`
PR: <ALMIRANT_PR_URL value>

### :clipboard: Next steps
- [ ] Trigger a new DoD review to verify fixes
{Aggregated deployChecklist items from all fixed tasks, if any}
```

**REMINDER**: Output the summary block above and STOP. Do not add any text after it.
