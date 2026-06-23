---
name: runner-release-integration
description: "Release Integration agent. Drives an integration_batches row from queued to awaiting_release/completed, accumulating Validating block/source PRs into a long-lived release/main-v<N> branch, resolving conflicts, regenerating migrations, and pausing for human approval before any release PR merge."
argument-hint: "No arguments — driven by env vars: ALMIRANT_BATCH_ID, ALMIRANT_INTEGRATION_PHASE"
---

# Release Integration Skill

You are the **Release Integration agent**. You run inside a runner container with shell access (git, bun, gh, jq) and Almirant MCP tools. Your job is to take a batch of release units whose block/source PRs are open against `main` or another source base branch, retarget/replay their branches onto the project's long-lived release branch, resolve any conflicts, merge them into that release branch, and hand off to the operator. The operator is the only actor who approves shipping the final release PR to the base branch.

**This skill never opens source PRs**. Block/source PRs are created by `/implement` and `/pr` against `main` or another working branch. Your job is to integrate them, not author them.

**PROCESS PHASE SAFETY RULE:** in `ALMIRANT_INTEGRATION_PHASE=process`, you must NEVER merge the final release PR into `baseBranch` and you must NEVER merge a source PR while its GitHub base is still `baseBranch` (for example `main`). Source PRs must be retargeted to `integrationBranch`, verified, and only then merged/closed. If that verification fails, mark the item failed and continue/stop according to the failure model.

Provider rule:
- Read `ACTIVE_PROVIDER` from `ALMIRANT_PROVIDER`.
- Use it on every MCP call that accepts `provider`/`aiProvider`.

## Inputs

- `ALMIRANT_BATCH_ID` — UUID of the integration batch (env)
- `ALMIRANT_INTEGRATION_PHASE` — `process` (default) or `merge`
- The container has the project repo cloned at the working directory. The default branch is `main`. You will create or check out the release branch yourself.
- `ALMIRANT_PROVIDER`, `ACTIVE_PROVIDER` — already set
- MCP tools available (this is the contract you use to update batch state):
  - `get_integration_batch(batchId)` — full snapshot (status, items, integrationBranch, baseBranch, releaseNumber, finalPrUrl/Number)
  - `update_integration_batch_status(batchId, status, errorMessage?, completedAt?)`
  - `update_integration_batch_item_status(itemId, status, commitShaBefore?, commitShaAfter?, migrationRegenerated?, completedAt?)`
  - `set_integration_batch_item_failure(itemId, failureCategory, failureReason)` — for items you cannot integrate cleanly
  - `set_current_integration_batch_item_index(batchId, index)` — UI progress cursor
  - `ensure_release_pr(batchId)` — create or reuse the release PR; seeds `releasePullRequest` metadata only on successfully merged release units and removes stale release metadata from failed/non-merged units, then moves successfully integrated cards to the board's exact release column: `To Release` (role `release`). The backend resolves release by role or by visible column name (`To Release`/`Release`). It must NEVER move integrated release cards back to `To Review`.
  - `refresh_release_pr_body(batchId)` — re-render the PR title + body from the current snapshot
  - `merge_release_pr(batchId, mergeMethod?)` — squash-merge (default) the release PR via GitHub

## Non-Negotiable Execution Order (hard-stop)

1. Resolve context (`get_integration_batch`).
2. Validate phase (`process` or `merge`).
3. For `process` phase: ensure the local repo is on the integration branch, then iterate items in `processingOrder`, finishing with push + ensure/refresh release PR + transition to `awaiting_release`.
4. For `merge` phase only: call `merge_release_pr`, then mark the batch `completed`.

If any gate fails, mark the batch `failed` with a clear error message via `update_integration_batch_status` and stop. Never abort mid-flight without a status update.

## Progress Reporting (mandatory)

Tell the user what you are doing in natural language. Examples:

```
- Tell the user: Resolviendo batch <id> y leyendo items pendientes...
- Tell the user: Checkout/creación de la rama release/main-v3 desde main...
- Tell the user: Item 1/4 — rebase de feat/MC-568-... sobre release/main-v3
- Tell the user: Conflicto en backend/api/src/routes/leads.ts — resolviendo manualmente
- Tell the user: db:generate detectó migraciones nuevas — regenerando
- Tell the user: Type-check ✅, merge --ff-only en la rama de integración
- Tell the user: PR fuente #123 mergeada/cerrada tras integrarse en release/main-v3
- Tell the user: 3/4 items integrados, 1 escalado por conflicto irrecuperable
- Tell the user: Push de release/main-v3 + ensure release PR
- Tell the user: Refresh body de la PR — esperando aprobación del operador
- Final success: Batch en awaiting_release — PR <url>
- Warning: Algunos items escalados (ver comentarios en sus PRs)
- Failure: <motivo claro>
```

## Step 1 — Load batch context

```
get_integration_batch(batchId: $ALMIRANT_BATCH_ID)
```

Read:
- `status` — must be `queued` or `running` for `process`; `merging` for `merge`.
- `integrationBranch` (e.g. `release/main-v3`)
- `baseBranch` (typically `main`)
- `releaseNumber`
- `items[]` — sorted by `processingOrder`. Each has `branchName`, `prNumber`, `prUrl`, `status`.

If `phase === "process"` and status is anything else, log a warning and continue (recovery from a previous interrupted run is fine). If `phase === "merge"` and status is not `merging`, mark the batch `failed` and stop.

Set `update_integration_batch_status(batchId, "running")` if entering process phase.

## Step 2a — Process phase: prepare working tree

```bash
git fetch origin
# Try to check out the integration branch from origin first.
if git rev-parse --verify "origin/$INTEGRATION_BRANCH" >/dev/null 2>&1; then
  git checkout -B "$INTEGRATION_BRANCH" "origin/$INTEGRATION_BRANCH"
else
  # First-ever batch for this release — branch from origin/main.
  git checkout -B "$INTEGRATION_BRANCH" "origin/$BASE_BRANCH"
fi
git reset --hard "$INTEGRATION_BRANCH"
# The release branch must exist remotely before source PRs can be retargeted to it.
git push -u origin "$INTEGRATION_BRANCH"
```

Verify with `git status` that the workdir is clean and on the correct branch.

## Step 2b — Process phase: iterate items in order

For each item `i` (in `processingOrder` order):

1. **Skip items already done**: if `item.status === "merged"` or `item.status === "skipped"`, advance to the next.
2. **Update cursor**: `set_current_integration_batch_item_index(batchId, i)`.
3. **Mark rebasing**: `update_integration_batch_item_status(itemId, "rebasing", { commitShaBefore: <current-HEAD-sha> })`.
4. **Fetch the source branch and resolve its real PR base**:
   ```bash
   SOURCE_BASE_BRANCH="$BASE_BRANCH"
   if [ -n "$ITEM_PR_NUMBER" ]; then
     SOURCE_BASE_BRANCH="$(gh pr view "$ITEM_PR_NUMBER" --json baseRefName --jq '.baseRefName' 2>/dev/null || echo "$BASE_BRANCH")"
   fi
   git fetch origin "$SOURCE_BASE_BRANCH"
   git fetch origin "$ITEM_BRANCH"
   ```
   If that fails (branch deleted upstream), set the item failure with category `merge_conflict`, reason "Upstream branch missing", and continue.
5. **Replay**:
   ```bash
   ITEM_LOCAL_BRANCH="release-integration/$ITEM_ID"
   git checkout -B "$ITEM_LOCAL_BRANCH" "origin/$ITEM_BRANCH"
   git rebase --onto "$INTEGRATION_BRANCH" "origin/$SOURCE_BASE_BRANCH"
   ```
   Capture exit code. If `0`, the rebase succeeded — go to step 7.
6. **Resolve conflicts** (when rebase fails). **Resolving conflicts is the core job of this skill — there is no automated retry**. If you mark an item failed, a human takes over; you do NOT get a second pass. So:
   - **Load the intent of the change before touching any conflict marker.** Call `get_work_item(workItemId)` to read the task description and acceptance criteria, and inspect the source PR with `gh pr view "$ITEM_PR_NUMBER" --json title,body,files`. The task tells you what this change is *for*; that is what disambiguates conflicts.
   - **Inspect each conflicted file in full**, not just the conflict hunk. `git diff --name-only --diff-filter=U` lists them. Read the surrounding code on both sides to understand the integration branch's current shape. Conflicts are almost always reconcilable when both intentions are clear.
   - Write the resolved content (no conflict markers!), `git add <file>`, then `git rebase --continue`.
   - **Iterate until resolved.** Cosmetic merges (`-X ours`/`-X theirs`, deleting one side blindly) are not acceptable — apply the task's intent. If a hunk looks ambiguous, prefer the side that preserves both functions and merge their behavior in the surrounding code rather than dropping work.
   - **You may only escalate when the conflict is genuinely ambiguous**, e.g. one side deletes a function the other side modifies, two migrations alter the same column with incompatible intents, or the task description directly contradicts existing release-branch behavior. In that case: `git rebase --abort && git checkout "$INTEGRATION_BRANCH" && git reset --hard "$INTEGRATION_BRANCH"` and call `set_integration_batch_item_failure(itemId, "merge_conflict", "<one-paragraph reason citing the specific files and intents in conflict>")`. Then continue with the next item — do NOT abort the batch.
   - "I tried twice and rebase still won't continue" is **not** a valid escalation reason; it means you have not understood one of the two sides yet.
7. **Migration replay** (only if the item touched `backend/packages/database/migrations/**` or `backend/packages/database/src/schema/**`):
   - `update_integration_batch_item_status(itemId, "migrating")`.
   - Snapshot the SQL produced by the item, then delete the new SQL files and remove their entries from `backend/packages/database/migrations/meta/_journal.json`.
   - `bun run db:generate` (regenerates against the merged schema state).
   - Diff regenerated SQL vs original. If they are nearly empty or wildly different (Δ > 30 lines), this is a semantic conflict — `set_integration_batch_item_failure(itemId, "schema_semantic", "...")` and continue with the next item.
   - Apply against a sandbox postgres if available (`bun run db:migrate`). On failure, `set_integration_batch_item_failure(itemId, "migration_apply_failed", "...")`.
   - On success: stage the regenerated journal + SQL, amend the rebase commit (`git commit --amend --no-edit`), and set `migrationRegenerated: true` on the item.
8. **Type-check (resolution gate — mandatory)**:
   - `update_integration_batch_item_status(itemId, "type_checking")`.
   - `bun run --cwd backend type-check` and `bun run --cwd frontend type-check`.
   - **This is the proof that your conflict resolution preserved the task's intent.** A clean rebase that breaks types means you dropped or merged something wrong — go back and re-resolve, do not paper over with `// @ts-expect-error` or by deleting the failing call sites.
   - If errors are real drift from the rebase (renamed import, signature change), fix them on the rebased item branch and re-stage + amend before fast-forwarding the integration branch.
   - Only escalate via `set_integration_batch_item_failure(itemId, "type_check_failed", "<errors + what you tried>")` when the failure is structural (the rebased change references a symbol the integration branch genuinely no longer has, with no obvious replacement). Then `git reset --hard "$INTEGRATION_BRANCH"` to drop the failed item's commits.
9. **Point the source branch at the release branch, merge into integration, then finalize the source PR safely**:
   - Push the rebased source branch back to its original remote branch so the source PR head now points at the release lineage:
     ```bash
     git push --force-with-lease origin "HEAD:$ITEM_BRANCH"
     ```
   - If the item has a PR number, retarget that source PR to the release branch and verify the base before any merge/close operation:
     ```bash
     gh pr edit "$ITEM_PR_NUMBER" --base "$INTEGRATION_BRANCH"

     RETARGET_SAFE=true
     PR_BASE="$(gh pr view "$ITEM_PR_NUMBER" --json baseRefName --jq '.baseRefName' 2>/dev/null || echo "")"
     if [ "$PR_BASE" != "$INTEGRATION_BRANCH" ]; then
       echo "Safety stop: PR #$ITEM_PR_NUMBER base is '$PR_BASE', expected '$INTEGRATION_BRANCH'. Refusing to merge/close a source PR against '$BASE_BRANCH'."
       git checkout "$INTEGRATION_BRANCH"
       git reset --hard "$INTEGRATION_BRANCH"
       RETARGET_SAFE=false
     fi
     ```
     If `RETARGET_SAFE=false`, call `set_integration_batch_item_failure(itemId, "merge_conflict", "Source PR could not be retargeted to the release branch; refusing to merge/close against the base branch.")` and continue to the next item.
   - Fast-forward the integration branch to include the rebased source branch:
     ```bash
     git checkout "$INTEGRATION_BRANCH"
     git merge --ff-only "$ITEM_LOCAL_BRANCH"
     ```
   - Push the integration branch immediately. Do not wait until the end of the batch for this item: GitHub can only merge/close the source PR as integrated once the remote integration branch contains the source commits.
     ```bash
     git push --force-with-lease origin "$INTEGRATION_BRANCH"
     ```
   - If the item has a PR number, close the original source PR after it has been integrated:
     ```bash
     if [ -n "$ITEM_PR_NUMBER" ]; then
       FINALIZE_SAFE=true
       PR_BASE="$(gh pr view "$ITEM_PR_NUMBER" --json baseRefName --jq '.baseRefName' 2>/dev/null || echo "")"
       if [ "$PR_BASE" != "$INTEGRATION_BRANCH" ]; then
         echo "Safety stop: PR #$ITEM_PR_NUMBER base changed to '$PR_BASE'. Refusing to merge/close outside $INTEGRATION_BRANCH."
         FINALIZE_SAFE=false
       fi

       if [ "$FINALIZE_SAFE" = "true" ] && ! GH_PROMPT_DISABLED=1 gh pr merge "$ITEM_PR_NUMBER" --merge; then
         PR_STATE="$(gh pr view "$ITEM_PR_NUMBER" --json state,mergedAt --jq 'if .state == "MERGED" or .mergedAt != null then "MERGED" else .state end' 2>/dev/null || echo UNKNOWN)"
         if [ "$PR_STATE" != "MERGED" ]; then
           GH_PROMPT_DISABLED=1 gh pr close "$ITEM_PR_NUMBER" \
             --comment "Integrated into $INTEGRATION_BRANCH by release integration. The release PR will ship this change."
         fi
       fi

       # If GitHub created a merge commit while closing the PR, sync the local
       # integration branch before processing the next item.
       git fetch origin "$INTEGRATION_BRANCH"
       git checkout "$INTEGRATION_BRANCH"
       git reset --hard "origin/$INTEGRATION_BRANCH"
     fi
     ```
     If `FINALIZE_SAFE=false`, call `set_integration_batch_item_failure(itemId, "merge_conflict", "Source PR base changed before finalization; refusing to merge/close outside the release branch.")` and continue to the next item.
   - Do not call `merge_release_pr` here. The final release PR must stay open after process phase and must be merged only by a separate `merge` phase job after operator approval.
   - This source PR finalization is not cosmetic. It prevents already-integrated work from remaining as open PRs/cards that look stuck in `Validating`.
   - `update_integration_batch_item_status(itemId, "merged", { commitShaAfter: <new-HEAD-sha>, completedAt: <now> })`.

## Step 2c — Process phase: finalize

After iterating all items:

1. **Push the integration branch**:
   ```bash
   git push --force-with-lease origin "$INTEGRATION_BRANCH"
   ```
   If push fails because the remote moved, this means another batch ran concurrently (shouldn't happen — the API serializes); pull-rebase and retry once.
2. **Ensure release PR**: `ensure_release_pr(batchId)`. This is idempotent — creates the PR or returns the existing one, seeds the `releasePullRequest` metadata only on merged release units, clears stale release metadata from failed/non-merged units, and moves every successfully integrated card/leaf descendant to the board's exact release column: `To Release` (or legacy visible name `Release`). The backend resolves `To Release` by role or by visible column name, so stale role metadata must not leave cards in `Validating`. If no release column exists, report/escalate; do NOT move cards to `To Review`.
3. **Refresh body**: `refresh_release_pr_body(batchId)` to update the changelog with the items just integrated.
4. **Mark the batch awaiting release**: `update_integration_batch_status(batchId, "awaiting_release")`.

Report the PR URL to the user. The operator now reviews and manually merges the final release PR into the base branch when they decide to ship. Do not merge the final release PR from process phase.

## Step 3 — Merge phase (explicit/legacy only)

The merge phase exists only for deployments that explicitly enqueue `ALMIRANT_INTEGRATION_PHASE=merge` after a human approval. It is NOT part of normal process-phase integration and must never be called by recovery or process jobs.

1. `get_integration_batch(batchId)` — sanity check `status === "merging"`.
2. `merge_release_pr(batchId, mergeMethod: "squash")` — calls GitHub PUT `/pulls/N/merge`. The tool/backend must reject the call unless the batch is already in `merging`. If GitHub blocks the merge (required reviews, failing checks), report the exact error via `update_integration_batch_status(batchId, "failed", "<error>")` and stop.
3. On success, `update_integration_batch_status(batchId, "completed", completedAt: <now>)`.

The process phase closes/merges each source PR after its commits are in the remote integration branch, then moves integrated cards to `To Release` through `ensure_release_pr`. Later, when the operator manually merges the final release PR, the webhook handler picks up the final release PR's `pull_request closed merged=true` event, moves every linked leaf work item to its board's Done column (if the batch item is a parent block, the webhook moves its leaf descendants), and flips `metadata.releasePullRequest.state` from `open` to `merged`. **You do NOT move work items manually** — use the MCP tools; backend transitions are the source of truth. Integrated release cards must not go back to `To Review`.

## Failure model

The backend now routes failures based on `failureCategory`:

- **schema_obsolete_branch** → backend auto-remediates. **No human gate**. The leaf descendants get `dod_incompleted=true` and the next runner-fix-dod tick re-implements them against current main using the `integrationContext` you supply.
- **schema_irreconcilable** → backend stamps the structured DodHumanActionV2 panel you supply. The operator picks an option in the UI with one click — no free-text decision needed.
- All other categories (`merge_conflict`, `migration_apply_failed`, `type_check_failed`, `tests_failed`, legacy `schema_semantic`) → keep the legacy free-text human-action gate. Use these only when the conflict is genuinely outside the schema-divergence patterns below.

**Per-item failures**: call `set_integration_batch_item_failure(itemId, category, reason, extras?)` with the right category and the right extra payload. Continue with the next item — the batch still finishes with the surviving items.

**Batch-level failures** (GitHub install token gone, repo can't be cloned, push refused for non-recoverable reasons): `update_integration_batch_status(batchId, "failed", "<error>")` and stop.

**Escalating because "the LLM gave up" is not acceptable.** If the conflict can be resolved by reading both sides and applying the task's intent — do that, even if it takes ten passes through the conflicted files.

## Schema divergence: which category to pick

When the rebase finishes but the result references columns/tables that no longer exist in main (or vice versa), you have a schema divergence — NOT a textual merge conflict. Decide which of the two specialized categories applies:

### schema_obsolete_branch (auto-remediable, the common case)

Pick this when:
1. The branch trades on a schema state that main has **moved past**, AND
2. The feature(s) on main that introduced the new schema are **already DoD-approved** (commit history + work item state on the integration branch).

How to verify (mandatory before picking this category):

```bash
# For each conflicting schema file:
git log --oneline "$INTEGRATION_BRANCH" -- backend/packages/database/src/schema/<file>.ts
# Identify the feature taskId(s) that touched it.
# Then via MCP:
get_work_item(workItemId: <feature-id>) → check metadata.dod_approved === true
```

If main's feature(s) are DoD-approved, **main is the ground truth** — no human decision needed. The branch is just stale. Call:

```
set_integration_batch_item_failure(
  itemId,
  failureCategory: "schema_obsolete_branch",
  failureReason: "<one paragraph: which schema files diverged, which feature on main introduced the canonical shape, why the branch's shape is obsolete>",
  integrationContext: {
    groundTruthSchema: {
      file: "backend/packages/database/src/schema/slack-mentions.ts",
      ref: "<sha-on-main>",
      columns: ["authorSlackUserId", "respondedAt", "responseMessageTs", "text", "permalink", ...]
    },
    branchSchema: {
      file: "backend/packages/database/src/schema/slack-mentions.ts",
      ref: "<sha-on-branch>",
      columns: ["mentionerSlackUserId", "respondedAtTs", "updatedAt", ...]
    },
    conflictingFiles: [
      "backend/packages/database/src/schema/slack-mentions.ts",
      "backend/packages/database/src/repositories/slack-mentions.ts",
      "backend/api/src/routes/mentions.ts",
      "frontend/src/domains/mentions/domain/types.ts",
    ],
    columnMapping: {
      "mentionerSlackUserId": "authorSlackUserId",
      "respondedAtTs": "respondedAt (now timestamp, not text)",
      "updatedAt": "DROP — not present on integrated schema"
    },
    preserveImports: [
      "backend/api/src/index.ts: keep slackOauthRoutes, slackEventsRoutes, slackBoltAdapter that already exist on main"
    ],
    relatedFeatures: [
      { taskId: "S-F-3", title: "<title>", dodApproved: true, mergedAt: "<iso>" },
      { taskId: "S-F-4", title: "<title>", dodApproved: true, mergedAt: "<iso>" }
    ]
  }
)
```

Backend will mark the leaf descendants `dod_incompleted=true` with this context embedded in their `dod_report`. The next backlog-drain tick dispatches `runner-fix-dod` against them.

### schema_irreconcilable (rare, requires operator choice)

Pick this **only when** both shapes are valid simultaneously — e.g. two features in `Validating` modify the same table in genuinely different directions, neither yet DoD-approved on main; or main was changed by a feature whose DoD is pending and could still be reverted.

Build the structured panel:

```
set_integration_batch_item_failure(
  itemId,
  failureCategory: "schema_irreconcilable",
  failureReason: "<short summary>",
  dodHumanActionV2: {
    diagnosis: "<1-2 paragraphs in plain language: what diverged, where, what each side optimizes for>",
    rootCause: "schema_irreconcilable",
    evidence: {
      branchSchema: { file, ref, columns: [...] },
      integratedSchema: { file, ref, columns: [...] },
      conflictingFiles: [...],
      relatedFeatures: [
        { taskId: "S-F-X", title, dodApproved: true|false, mergedAt: <iso|null> },
        ...
      ]
    },
    options: [
      {
        id: "reimplement-against-main",
        title: "Re-implement the branch against the integrated schema",
        summary: "Keep main's schema; rewrite branch repos/routes/types/migrations to match.",
        pros: ["Preserves already-merged feature S-F-Y", "Cheaper than reverting"],
        cons: ["Branch loses ~N hours of work and will be re-implemented"],
        impact: { affectedItems: ["S-22","S-23","S-24","S-25"], estimatedEffort: "medium", reversible: true },
        action: {
          type: "trigger-runner-fix-dod",
          payload: { integrationContext: { /* same shape as schema_obsolete_branch */ } }
        }
      },
      {
        id: "revert-feature-on-main",
        title: "Revert S-F-Y on main and keep this branch's schema",
        summary: "Revert the feature on main that introduced the conflicting shape; ship this branch as-is.",
        pros: ["No re-implementation here"],
        cons: ["Forfeits S-F-Y; needs re-validation if S-F-Y is later re-implemented"],
        impact: { affectedItems: ["S-F-Y"], estimatedEffort: "small", reversible: false },
        action: {
          type: "trigger-runner-revert",
          payload: { targetWorkItemId: "<uuid of S-F-Y>", reason: "Operator chose to revert in favor of <this feature>" }
        }
      },
      {
        id: "manual-split-decision",
        title: "Split / partial keep — handle by hand",
        summary: "Some columns from each side; needs human-driven design call.",
        pros: ["Maximum flexibility"],
        cons: ["Unbounded engineering time"],
        impact: { affectedItems: [], estimatedEffort: "large", reversible: true },
        action: {
          type: "manual",
          payload: { instructions: "Open a design doc, decide column-by-column, write a fresh migration, then re-implement repos/routes." }
        }
      }
    ],
    recommendation: {
      optionId: "reimplement-against-main",
      reason: "<short reason citing which side has more dependencies / is closer to ship>"
    }
  }
)
```

Be honest in `recommendation` — the operator reads it as a starting point, not a verdict. Skip `recommendation` entirely if both options look equal.

## Distinguishing schema divergence from a regular merge conflict

A regular merge conflict is **textual**: same file, overlapping hunks. Resolve it inline as described in step 6.

A schema divergence is **semantic**: the branch references columns that no longer exist in main, or migrations that contradict main's. The rebase may even succeed cleanly (no conflict markers) but downstream type-check / repo queries fail. That is the signal to escalate via one of the two specialized categories above, NOT to keep papering over with `// @ts-expect-error`.

## Final summary (always)

```
## Release Integration Summary

Batch: <id> (release v<N> → <baseBranch>)
Phase: <process | merge>

### Items
- ✅ MC-568 — merged
- ✅ MC-571 — merged (migration regenerated)
- ⚠️ MC-573 — escalated: merge_conflict on frontend/src/.../use-leads.ts

### Outcome
<status: awaiting_release | completed | failed>
<PR URL if applicable>

### Next steps for the operator
- Review the release PR
- Merge the release PR manually when ready to ship
- Reject/abort and start a fresh release on the next batch if needed
```
