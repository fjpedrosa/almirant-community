---
name: dod-review
description: Review Almirant work items that are in a review column against their metadata Definition of Done. Use for scheduled or manual DoD gate jobs that must approve the task or send it back to Backlog with a report via MCP.
---

# Definition of Done Review

## Purpose

Act as a read-only quality gate after implementation. Your job is to verify whether each assigned work item satisfies its `metadata.definitionOfDone`, then persist the result with the MCP tool `complete_definition_of_done_review`.

DoD Review is block-based: when the assigned work item is a parent block (`epic`, `feature`, or `story`), review only the pending reviewable child tasks inside it. A child is pending when it is in the Review column, does not already have `metadata.dod_approved=true` or `metadata.dod_incompleted=true`, and is not blocked by human-only or external-validation metadata (`metadata.dod_human_action_required`, `metadata.dod_human_review_required`, `metadata.dod_auto_remediation_blocked`, `metadata.dod_external_validation_required`, or `metadata.dod_external_validation_tools`). Already-approved, already-incomplete, human-action-blocked, or external-validation-blocked children are skipped and reported as skipped, not re-reviewed. The current DoD run is approved only when every pending reviewed child passes with evidence. If one pending reviewed child fails or is unverifiable, the run is `incompleted`.

## Non-negotiables

- Do not edit code, commit, push, create branches, or open PRs.
- Do not mark approved from vibes. Every approval needs evidence from the implementation, PR diff, transcript, tests, or work item context.
- If there is no clear Definition of Done, mark the item `incompleted` with a report saying the DoD is missing or unverifiable.
- Review only the assigned work item IDs unless the assigned item is a parent block or the DoD explicitly depends on parent/sibling context.
- For parent blocks, call `get_review_context` with `featureReview: true`, then review every pending `reviewableChildren` entry only. Skip children whose metadata already has `dod_approved=true`, `dod_incompleted=true`, `dod_human_action_required=true`, `dod_human_review_required=true`, `dod_auto_remediation_blocked=true`, `dod_external_validation_required=true`, or non-empty `dod_external_validation_tools`, and mention them as skipped.
- Call `complete_definition_of_done_review` once for the parent block ID, not once per child.
- Never approve a pending reviewed child from partial evidence. One failed/unknown criterion in a pending reviewed child makes the current DoD run `incompleted`. Skipped children do not participate in the current run result.
- Never mark a human-only blocker `incompleted` just because automation cannot perform the human action. Leave those cards in Review for the human and report exactly what action is needed.
- Never move cards manually. The MCP completion tool owns state changes and comments.

## Workflow

1. Resolve the assigned work item with the available Almirant MCP/context tools.
   - For a task/idea, review the item directly.
   - For an epic/feature/story, load full block context with `get_review_context({ taskId, featureReview: true })` and treat `reviewableChildren` as the required evidence scope.
2. Read the title, description, implementation notes/comments, `metadata.definitionOfDone`, `metadata.pullRequest`, and for parent blocks each reviewable child's title, description, DoD, notes, PR metadata, status, and `metadata.agentHints`. For parent blocks, split children into pending vs skipped before evaluating: skip children with `metadata.dod_approved=true`, `metadata.dod_incompleted=true`, human-action metadata, or external-validation metadata.
3. Inspect implementation evidence:
   - If a PR branch exists, fetch it and review the diff against its base branch.
   - Check changed files relevant to the DoD.
   - Run targeted read-only checks only when needed. Do not build.
4. Evaluate each DoD criterion as `pass`, `fail`, or `unknown`.
   - For parent blocks, group the report by child task and include evidence per child.
5. For each **failing** child task, prepare a **per-task fix recipe** (see format below). This is mandatory — do not skip this step for any failing task.
6. Call `complete_definition_of_done_review` exactly once per assigned work item:
   - `result: "approved"` when all pending reviewed criteria pass with evidence.
   - `result: "incompleted"` when any pending reviewed criterion fails or is unverifiable.
   - Pass DoD checkbox statuses so the UI can show progress directly in `metadata.definitionOfDone`:
     - For a single task/idea, use `definitionOfDoneCriteria`.
     - For a parent block, use `definitionOfDoneCriteriaByWorkItemId` keyed by each pending reviewed child work item ID. Do not include skipped children.
     - Each `text` must be the exact original DoD criterion text without the `- [ ]` / `- [x]` checkbox marker and without evidence notes.
     - Use `status: "pass"` only when evidence proves the criterion; use `fail` or `unknown` otherwise. The completion tool marks pass as `[x]` and fail/unknown/omitted as `[ ]`.
   - For parent blocks, pass the parent block ID. The completion tool owns the aggregate workflow state for the block and descendants.
7. After calling `complete_definition_of_done_review`, update **each failing child task** with its per-task report. Call `update_work_item` once per failing child:
   ```
   update_work_item(childId, {
     metadata: {
       dod_report: <per-task fix recipe text prepared in step 5>,
       dod_suggested_agents: ["<primary-agent>"]
     }
   })
   ```
   This overwrites any inherited block-level report with a task-specific recipe, so `runner-fix-dod` can assign the right specialist and act directly without investigation.

   For a single failing task/idea (not a block), call `update_work_item` on the same item immediately after `complete_definition_of_done_review` to set `dod_suggested_agents`.

## Per-task fix recipe format

For each failing task, write a recipe detailed enough that a **junior implementation agent** can execute it without needing to investigate further. Assume the agent has no architectural knowledge — leave nothing to interpretation.

```markdown
## DoD Fix Recipe: {TASK_ID} — {TASK_TITLE}

### Failing criteria
- [ ] {exact criterion text} — {why it failed, with specific evidence}

### Files to touch
- `{relative/path/to/file.ts}` — {what to change and why}
- `{relative/path/to/other.tsx}` — {what to change and why}

### Specific changes required
{For each file: name the exact function/component/section to modify. Describe what to add, remove, or change. Include a short code snippet or pseudodiff if the change is non-trivial. Be as precise as a code review comment.}

### Verification steps
{Concrete commands or manual steps to confirm the fix, e.g.:
- `bun run type-check` in `frontend/` — must exit 0
- Navigate to /settings and verify X renders without errors
- Call `GET /api/endpoint` and confirm response contains field Y}

### Suggested agent
{Primary agent type from the selection table, e.g. `frontend-developer`.
Secondary agent if the fix crosses domains, e.g. `backend-architect`.}
```

If the fix is trivial (e.g., add a missing JSDoc comment, fix one lint rule), say so explicitly so the implementation agent does not over-engineer.

## Agent selection for fix

Use `metadata.agentHints` from the work item as the primary signal. When hints are absent, infer from the failing criterion text and the files that need to change:

| Task involves | Agent |
|---|---|
| Frontend components (`.tsx`), React UI, presentational | `frontend-developer` |
| Frontend hooks, state management, React Query | `frontend-developer` |
| Clean Architecture compliance, DDD layer separation | `frontend-clean-architect` |
| Backend routes, Elysia endpoints, middleware | `backend-architect` |
| Database schema, Drizzle queries, repositories | `database-architect` |
| Pure TypeScript logic, utilities, transformers | `javascript-pro` |
| JSDoc, inline comments, code documentation | `javascript-pro` |
| ESLint fixes, lint-only changes | `javascript-pro` |
| API documentation, endpoint docs, README updates | `api-documenter` |
| UI/UX, layout, design system tokens | `ui-ux-designer` |

For fixes that cross domains (e.g., a backend endpoint change that requires a frontend hook update), list two agents: `["backend-architect", "frontend-developer"]`. `runner-fix-dod` will assign the primary one and note the secondary.

## Report format

Use a concise markdown report:

```markdown
## Definition of Done Review

### Result
Approved | Incompleted

### Criteria
- [x] Criterion — evidence
- [ ] Criterion — missing evidence or failure reason

### Child Results
- `TASK-1` — Approved — all criteria verified
- `TASK-2` — Incompleted — missing JSDoc on exported functions
- `TASK-3` — Skipped — already had `metadata.dod_approved=true` before this run

### Per-Task Fix Recipes (failing tasks only)

#### TASK-2 — {Title}
{Full fix recipe in the format defined above}

#### TASK-N — {Title}
{Full fix recipe}

### Notes
- Overall context, blocking issues, or risks.
```

Example `complete_definition_of_done_review` call for a single task:

```json
{
  "workItemId": "…",
  "result": "incompleted",
  "report": "## Definition of Done Review\n…",
  "definitionOfDoneCriteria": [
    { "text": "TypeScript compiles without errors.", "status": "pass" },
    { "text": "ESLint passes without warnings.", "status": "unknown" }
  ]
}
```
