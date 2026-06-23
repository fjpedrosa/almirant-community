---
name: document
description: Generate documentation and screenshots for work items in Release column, then move to Done. Creates Almirant documents linked to work items.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Document Skill

You are given **one or more work item IDs** (e.g. `A-425`, `A-F-125`, `MC-10`). They can be tasks, stories, features, or epics. Your job is to resolve them to leaf tasks in the **Release** column, generate documentation (with optional screenshots), create Almirant documents linked to those work items, and move them to **Done**.

Provider rule:

- Resolve `ACTIVE_PROVIDER` from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:

1. Resolve context (`get_document_context`).
2. Create/activate worktree for session isolation.
3. Only then start screenshot capture and documentation generation.

If any gate fails, report the failure clearly and stop.

## Step 0: Parse input and resolve context

Split `$ARGUMENTS` by whitespace to extract the list of IDs. Accept the workspace work-item format (e.g. `A-425`, `A-F-125`, `MC-10`, `MC-F-42`) and do not hardcode a single prefix.

If no valid IDs are found, tell the user and stop.

Use a single call:

1. `get_document_context(ids: [ ...input IDs... ])`
2. Read:
   - `tasks.documentable`: leaf tasks in the Release column. Each task may include:
     - `walkthroughRecordings`: array of `{ attachmentUrl, viewport, duration }` for completed walkthrough videos
     - `hasCompletedWalkthrough`: boolean indicating whether a completed walkthrough exists
   - `tasks.skipped`: tasks not in Release (with `skipReason`)
   - `boardContext`: semantic `columnMap` per board (includes `done` column ID)
   - `parentItems`: parent summaries with children counts per column
   - `existingDocs`: existing Almirant documents for context
3. If `documentable` is empty, report skips and stop.
4. For each documentable task, check `hasCompletedWalkthrough`. If `true`, collect the `attachmentUrl` values from `walkthroughRecordings` — these will be passed to subagents and to `complete_documentation`.

Report to the user:

```
Documentation pipeline for X tasks:
  - Documentable: Y tasks in Release
  - Skipped: Z tasks (not in Release)
```

Write a marker file for token tracking:

```bash
echo '{"workItemIds":["<UUID1>","<UUID2>"],"startedAt":"<ISO_TIMESTAMP>","model":"<YOUR_MODEL_ID>","provider":"<YOUR_PROVIDER>","skill":"document","sessionType":"document"}' > /tmp/mc-ai-session-marker.json
```

## Step 0.5: Create worktree for session isolation

Before running any documentation phases, isolate changes in a dedicated worktree. This allows multiple `/document` sessions to run in parallel without conflicts, and leaves the main repo's working directory untouched.

### 0.5a. Detect if already in a worktree

```bash
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
```

**Decision logic:**

- If `git rev-parse` fails entirely -> not a git repo. Set `WORKTREE_PATH` to the current working directory, `CREATED_WORKTREE = false`, and skip to Step 1 (backwards compatibility).
- If `GIT_COMMON_DIR` contains `.git/worktrees/` -> already inside a worktree. Set `WORKTREE_PATH` to `$(git rev-parse --show-toplevel)`, `CREATED_WORKTREE = false`, and skip to Step 1.
- Otherwise -> in the main repository. Proceed to 0.5b.

### 0.5b. Determine branch name

Use the **first input ID** to derive the branch name:

| Input scope | Branch example |
|---|---|
| Single task (`A-425`) | `document/A-425-2026-03-11-143500` |
| Single feature (`A-F-125`) | `document/A-F-125-2026-03-11-143500` |
| Multiple IDs | `document/A-425-A-426-2026-03-11-143500` |

Include a timestamp suffix (`YYYY-MM-DD-HHMMSS`) to ensure uniqueness for re-runs.

Full branch name: `document/<ID(s)>-<timestamp>` (e.g. `document/A-425-2026-03-11-143500`)

### 0.5c. Fetch and check for existing remote branch

```bash
git fetch origin
```

Check if a remote branch already exists for this documentation session (re-run scenario):

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

**If no existing remote branch** (fresh documentation):

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

**Important**: From this point forward, ALL file operations, builds, and git commands must use `WORKTREE_PATH` as the working directory.

## Progress Reporting (mandatory)

Report progress in natural language on their own line throughout execution:

```
- Tell the user: Resolviendo tareas y contexto...
- Tell the user: Worktree creado en .worktrees/document/A-XXX — instalando dependencias...
- Tell the user: Screenshots — 3 tasks...
- Tell the user: Generando documentacion — 3 tasks...
- Tell the user: Escribiendo docs al filesystem...
- Tell the user: Completando — moviendo a Done...
- Final success example: Documentacion completada: X tasks en Done
- Warning example: Completado con screenshots omitidos
- Failure example: <motivo si falla completamente>
```

Report success clearly on full success, a warning if some phases were skipped, an error if everything failed. Never skip the final outcome summary.

## Step 1: Screenshots with Playwright MCP (SEQUENTIAL, one task at a time)

For each documentable task with frontend UI changes, capture screenshots. Run SEQUENTIALLY (single browser session).

### 1a. Infer URLs from changed files

Use `metadata.changedFiles` or recent commits for the task to determine which pages to screenshot:

| Changed files pattern | URL |
|---|---|
| `domains/boards/**` or `app/(dashboard)/boards/**` | `/boards` |
| `domains/leads/**` or `app/(dashboard)/people/**` | `/people` |
| `domains/documents/**` or `app/(dashboard)/docs/**` | `/docs` |
| `domains/work-items/**` | `/boards` |
| `domains/settings/**` or `app/(dashboard)/settings/**` | `/settings` |
| `domains/projects/**` or `app/(dashboard)/projects/**` | `/projects` |
| `domains/dashboard/**` or `app/(dashboard)/(home)/**` | `/` |

If no changed files are available or the task has no frontend UI changes, skip screenshots for that task.

### 1b. Take screenshots

For each inferred URL:

1. `browser_navigate` to `http://localhost:3000<URL>`
2. Wait for page to load: `browser_wait_for` (selector or networkidle)
3. `browser_take_screenshot` (viewport: 1280x720)
4. Save to `/tmp/document-screenshot-<task-id>-<slug>-<timestamp>.png`
5. Upload: `upload_work_item_attachment(workItemId, filePath, fileName, metadata: { kind: "documentation-screenshot", page: URL }, deleteAfterUpload: true)`
6. Track uploaded screenshot URLs per task

**If Playwright MCP is unavailable or errors**: Skip silently. Set `screenshots: []` for that task. Do NOT block the pipeline. Report a warning clearly in summary.

## Step 2: Generate documentation per task (PARALLEL subagents)

Launch documentation agents in parallel, one per task.

Agent: `api-documenter` (inherit model -- do NOT pass `model` parameter)

**Subagent prompt template:**

```
You are documenting work item {TASK_ID}: "{TITLE}"

## Working Directory
All work MUST happen inside the worktree at: {WORKTREE_PATH}

## Task Details
- **Type**: {TYPE} | **Priority**: {PRIORITY}
- **Description**: {DESCRIPTION}
- **Definition of Done**: {DOD or "Not specified"}

## Changed Files
{CHANGED_FILES_FROM_METADATA}

## Test Results
{TEST_RESULTS_FROM_METADATA}

## Screenshots
{SCREENSHOT_URLS}

## Walkthrough Videos
{WALKTHROUGH_RECORDINGS or "No walkthrough available"}
(If walkthroughs are present, each entry has: attachmentUrl, viewport, duration)

## Existing Project Documents (for context)
{EXISTING_DOCS_LIST}

## Instructions

1. Read the changed files to understand what was implemented.
2. Write a concise 1-2 sentence summary.
3. If more than 3 files changed, generate a Mermaid architecture diagram (max ~20 nodes):
   - New modules in green (style X fill:#d4edda)
   - Modified modules in yellow (style X fill:#fff3cd)
   - Use `flowchart LR` for horizontal flows
4. Write a changelog entry (1 line, present tense).
5. Generate full documentation in Markdown:
   - Title: "{TASK_ID}: {TITLE}"
   - Summary section
   - Changes section with details
   - Screenshots embedded as ![Screenshot](url)
   - If walkthrough videos are available, add a "Video Walkthrough" section with links to each recording (include viewport and duration info)
   - Architecture diagram if generated
   - Changelog entry
6. Report JSON:
   {
     "documentTitle": "TASK_ID: TITLE",
     "documentContent": "full markdown content",
     "summary": "1-2 sentences",
     "mermaidDiagrams": ["flowchart LR\n  ..."] or [],
     "walkthroughUrls": ["url1", ...] or [],
     "changelogEntry": "...",
     "category": "changelog" | "technical" | "feature"
   }
```

**CRITICAL**: Launch ALL doc agents in a **single message** with multiple `Task` tool calls for true parallel execution.

### Parse subagent results

For each completed agent, parse the `<usage>` tag from the subagent's output:

```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Extract `total_tokens` (integer) and `duration_ms` (integer). If the tag is missing, compute `durationMs` from marker file timestamps and set `totalTokens` to 0.

Parse the JSON report from each agent's output. If an agent fails or produces invalid JSON, mark that task as failed and continue with others.

## Step 3: Write docs to filesystem (in worktree)

For each successfully documented task:

1. Ensure the output directory exists:

   ```bash
   mkdir -p "$WORKTREE_PATH/docs-internal/product/changelog"
   ```

2. Write the documentation file:
   - Path: `docs-internal/product/changelog/<TASK-ID>-<slug>.md`
   - Slug generation: `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)`
   - Content: the `documentContent` from the subagent's JSON report

3. Commit per task:

   ```bash
   cd "$WORKTREE_PATH" && git add docs-internal/ && git commit -m "$(cat <<'EOF'
   docs(TASK-ID): add documentation for TITLE
   EOF
   )"
   ```

### Feature/Epic aggregate documentation

If the input IDs included a feature or epic, after all per-task docs are written, create an aggregate document:

1. Ensure the features directory exists:

   ```bash
   mkdir -p "$WORKTREE_PATH/docs-internal/product/features"
   ```

2. Write aggregate doc to `docs-internal/product/features/<FEATURE-ID>-<slug>.md`:

   ```markdown
   ---
   title: "A-F-XX: Feature Title"
   description: "Auto-generated documentation"
   ---

   # Feature Title

   ## Summary
   [Aggregated from task summaries]

   ## Changes

   ### A-XXX: Task Title
   [Task summary]
   ![Screenshot](attachment-url)

   ### A-YYY: Task Title
   [Task summary]

   ## Architecture
   [Combined Mermaid diagrams]

   ## Changelog
   [Combined changelog entries]
   ```

3. Commit the aggregate doc:

   ```bash
   cd "$WORKTREE_PATH" && git add docs-internal/ && git commit -m "$(cat <<'EOF'
   docs(A-F-XX): add aggregate feature documentation
   EOF
   )"
   ```

## Step 4: Complete + move to Done

For each documented task, call `complete_documentation` (single atomic call):

```
complete_documentation(
  workItemId: "<UUID>",
  doneColumnId: "<from boardContext.columnMap.done>",
  documentTitle: "<from doc agent output>",
  documentContent: "<full markdown from doc agent>",
  documentCategoryId: "<optional, if category mapping exists>",
  screenshotUrls: [<urls from Step 1>],
  walkthroughUrls: [<urls from walkthroughRecordings if hasCompletedWalkthrough>],
  model: "<MODEL_USED_BY_SUBAGENT>",
  provider: ACTIVE_PROVIDER,
  totalTokens: <tokens>,
  durationMs: <duration>,
  taskId: "A-XXX"
)
```

This atomically: moves to Done, clears AI processing, creates Almirant document, links doc to work item, records AI session.

**Walkthrough URLs**: Extract `attachmentUrl` values from the task's `walkthroughRecordings` (from Step 0 context) and pass them as `walkthroughUrls`. This is ADDITIVE — screenshots are still captured and used as before. Walkthroughs are bonus content when available.

**Model rule**: Do NOT translate agent type into a fixed model. Record the actual model that ran; by default this is the inherited session model selected by the user.

**If `complete_documentation` fails**: Retry 1 time. If still fails, leave the item in Release, add a comment explaining the failure via `add_work_item_comment(workItemId, "Documentation generation completed but failed to move to Done: <error>")`, and continue with other tasks.

## Step 5: Parent promotion

After all tasks are processed, check `parentItems` from Step 0:

For each parent:

- Re-resolve children status: `resolve_work_items(ids: [parentId], includeLeafTasks: true)`
- If ALL children are in Done columns -> move parent to Done:
  `move_work_item(parentId, doneColumnId)`
- If SOME children are not in Done -> report which children block the parent.

## Step 6: Summary report + push branch

### Push the branch if commits exist

```bash
cd "$WORKTREE_PATH" && git log origin/main..HEAD --oneline
```

If commits exist:

```bash
cd "$WORKTREE_PATH" && git push -u origin <branch-name>
```

### Present final summary

```
## Documentation Summary

**Input**: N work items | **Resolved tasks**: X
**Worktree**: <branch-name> (or "main repo" if no worktree created)
**Screenshots**: S captured
**Documented**: D tasks
**Completed**: C tasks moved to Done
**Skipped**: K tasks

### Results

| Task | Title | Screenshots | Doc | Final Status |
|------|-------|-------------|-----|--------------|
| A-XX | "Title" | 2 | Yes | Done |
| A-YY | "Title" | 0 | Yes | Done |

### Completed tasks (Done)
- **A-XX**: [Summary]
  - Doc: [title]
  - Screenshots: [list]

### Skipped tasks
- **A-WW**: Column 'Validating' is not Release

### Parent items
- **A-F-XX**: 4/4 children in Done -> promoted to Done

### Branch
- Branch: <branch-name>
- Pushed: yes/no

### Next steps for you
- [ ] Review generated documentation in docs-internal/product/changelog/
- [ ] Merge documentation branch if satisfied
```

## Error Handling

### Worktree creation failure

If `git worktree add` fails:

- Report the error to the user
- If in the main repo, continue without worktree (backwards compatibility)
- If already in a worktree, report and stop

### Screenshots fail

If Playwright MCP is unavailable or errors for a specific task:

- Skip screenshots for that task silently
- Set `screenshots: []` in the documentation call
- Annotate in the summary: "Screenshots skipped (Playwright unavailable)"
- Do NOT block the pipeline

### Documentation generation fails

If a subagent fails or produces invalid output for a task:

- Leave the item in Release column
- Add a comment explaining the failure: `add_work_item_comment(workItemId, "Documentation generation failed: <error>")`
- Continue with other tasks
- Report in summary as failed

### `complete_documentation` fails

- Retry 1 time
- If still fails, leave in Release and add comment explaining
- Continue with other tasks

### Phase failures do NOT block other tasks

If a task fails at any phase (screenshots, doc generation, completion), other tasks continue normally. Each task is independent.

### Token tracking

Per subagent, parse the `<usage>` tag:

```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Accumulate per task. Use accumulated totals in `complete_documentation`.

If `<usage>` tag is missing, compute `durationMs` from marker file timestamps and set `totalTokens` to 0.
