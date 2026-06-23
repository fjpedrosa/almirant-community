---
name: runner-document
description: Remote runner variant of document. Works inside a pre-configured container with a branch. Generates documentation, creates Almirant documents, commits once, pushes, creates PR ready for review, and moves tasks to Done.
argument-hint: <work-item-id-1> [work-item-id-2] [work-item-id-N...]
---

# Runner Document Skill

You are given **one or more work item IDs** (e.g. `A-425`, `A-F-125`, `MC-10`). They can be tasks, stories, features, or epics. Your job is to resolve them to leaf tasks in the **Release** column, generate documentation, create Almirant documents linked to those work items, commit all docs in a single commit, push the branch, create a PR ready for review, and move tasks to **Done**.

Provider rule:
- If the environment variable `ALMIRANT_PROVIDER` is set, use its value as `ACTIVE_PROVIDER` (values: `anthropic`, `openai`, `zai`).
- Otherwise, resolve from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Key Differences from `/document`

This skill runs inside a **runner container** where:
- A branch is already created by the job executor. Do NOT create a new branch or worktree.
- The workspace is pre-configured at the current working directory.
- Git credentials are already configured. You can push directly.
- After documenting ALL tasks, make a **single commit** with all docs, push, and create a PR.

## Non-Negotiable Execution Order (hard-stop)

1. Resolve context (`get_document_context`).
2. Capture screenshots (if applicable).
3. Generate documentation for all tasks (parallel subagents).
4. Write all docs to filesystem.
5. Single commit + push + create PR.
6. Complete tasks in Almirant (move to Done).

If any gate fails, report the failure clearly and stop.

## Step 0: Parse input and resolve context

Split `$ARGUMENTS` by whitespace to extract the list of IDs.

If no valid IDs are found, tell the user and stop.

Use a single call:
1. `get_document_context(ids: [ ...input IDs... ])`
2. Read:
   - `tasks.documentable`: leaf tasks in the Release column
   - `tasks.skipped`: tasks not in Release (with `skipReason`)
   - `boardContext`: semantic `columnMap` per board (includes `done` column ID)
   - `parentItems`: parent summaries with children counts per column
   - `existingDocs`: existing Almirant documents for context
3. If `documentable` is empty, report skips and stop.

## Step 0-bis: Load shared memory for documentation context

Before writing docs:

1. Call `mem_context` with the resolved `projectId`, `types: ["decision", "pattern", "bugfix"]`, and a small `limit`.
2. Build a focused query from the resolved task titles/descriptions and call `mem_search`.
3. Use relevant learnings to enrich the documentation with prior decisions and known gotchas.

Report:
```
Documentation pipeline for X tasks:
  - Documentable: Y tasks in Release
  - Skipped: Z tasks (not in Release)
```

Write a marker file for token tracking:
```bash
echo '{"workItemIds":["<UUID1>","<UUID2>"],"startedAt":"<ISO_TIMESTAMP>","model":"<YOUR_MODEL_ID>","provider":"<YOUR_PROVIDER>","skill":"runner-document","sessionType":"document"}' > /tmp/mc-ai-session-marker.json
```

## Progress Reporting (mandatory)

Report progress in natural language on their own line. The runner relays these to Discord.

```
- Tell the user: Resolviendo tareas y contexto...
- Tell the user: Screenshots — N tasks...
- Tell the user: Generando documentacion — N tasks...
- Tell the user: Escribiendo docs al filesystem...
- Tell the user: Commit, push y creando PR...
- Tell the user: Completando — moviendo a Done...
- Final success example: Documentacion completada: X tasks en Done — PR: <url>
- Warning example: Completado con screenshots omitidos
- Failure example: <motivo si falla completamente>
```

## Step 1: Screenshots with Playwright MCP (SEQUENTIAL)

For each documentable task with frontend UI changes, capture screenshots.

### 1a. Infer URLs from changed files

Use `metadata.changedFiles` or recent commits to determine which pages to screenshot:

| Changed files pattern | URL |
|---|---|
| `domains/boards/**` or `app/(dashboard)/boards/**` | `/boards` |
| `domains/leads/**` or `app/(dashboard)/people/**` | `/people` |
| `domains/documents/**` or `app/(dashboard)/docs/**` | `/docs` |
| `domains/work-items/**` | `/boards` |
| `domains/settings/**` or `app/(dashboard)/settings/**` | `/settings` |
| `domains/projects/**` or `app/(dashboard)/projects/**` | `/projects` |
| `domains/dashboard/**` or `app/(dashboard)/(home)/**` | `/` |

If no changed files or no frontend UI changes, skip screenshots for that task.

### 1b. Take screenshots

For each inferred URL:
1. `browser_navigate` to `http://localhost:3000<URL>`
2. Wait for page to load: `browser_wait_for`
3. `browser_take_screenshot` (viewport: 1280x720)
4. Save to `/tmp/document-screenshot-<task-id>-<slug>-<timestamp>.png`
5. Upload: `upload_work_item_attachment(workItemId, filePath, fileName, metadata: { kind: "documentation-screenshot", page: URL }, deleteAfterUpload: true)`
6. Track uploaded screenshot URLs per task

**If Playwright MCP is unavailable**: Skip silently. Set `screenshots: []`. Report a warning clearly in summary.

## Step 2: Generate documentation per task (PARALLEL subagents)

Launch documentation agents in parallel, one per task.

Extract `documentationNotes` from the task's metadata. If absent, use `"No documentation notes provided."`.

Agent: `api-documenter` (inherit model -- do NOT pass `model` parameter)

**Subagent prompt template:**
```
You are documenting work item {TASK_ID}: "{TITLE}"

## Working Directory
All work MUST happen in the current working directory (already set up by the runner).

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

## Documentation Notes (from implementation agent)
{DOCUMENTATION_NOTES or "No documentation notes provided."}

Use these notes as primary guidance for what to document.

## Existing Project Documents (for context)
{EXISTING_DOCS_LIST}

## Instructions

1. Read the changed files to understand what was implemented.
2. If Documentation Notes are provided, use them as primary guidance.
3. Write a concise 1-2 sentence summary.
4. If more than 3 files changed, generate a Mermaid architecture diagram (max ~20 nodes):
   - New modules in green (style X fill:#d4edda)
   - Modified modules in yellow (style X fill:#fff3cd)
   - Use `flowchart LR` for horizontal flows
5. Write a changelog entry (1 line, present tense).
6. Generate full documentation in Markdown:
   - Title: "{TASK_ID}: {TITLE}"
   - Summary section
   - Changes section with details
   - Screenshots embedded as ![Screenshot](url)
   - Architecture diagram if generated
   - Changelog entry
7. Report JSON:
   {
     "documentTitle": "TASK_ID: TITLE",
     "documentContent": "full markdown content",
     "summary": "1-2 sentences",
     "mermaidDiagrams": ["flowchart LR\n  ..."] or [],
     "changelogEntry": "...",
     "category": "changelog" | "technical" | "feature"
   }
```

**CRITICAL**: Launch ALL doc agents in a **single message** with multiple `Task` tool calls for true parallel execution.

### Parse subagent results

Parse the `<usage>` tag from each subagent:
```
<usage>total_tokens: 62078
tool_uses: 4
duration_ms: 21922</usage>
```

Parse the JSON report. If an agent fails or produces invalid JSON, mark that task as failed and continue with others.

## Step 3: Write all docs to filesystem

For each successfully documented task:

1. Ensure the output directory exists:
   ```bash
   mkdir -p docs-internal/product/changelog
   ```

2. Write the documentation file:
   - Path: `docs-internal/product/changelog/<TASK-ID>-<slug>.md`
   - Slug: `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)`
   - Content: the `documentContent` from the subagent's JSON report

### Feature/Epic aggregate documentation

If the input IDs included a feature or epic, create an aggregate document at `docs-internal/product/features/<FEATURE-ID>-<slug>.md` combining all task summaries, diagrams, and changelog entries.

## Step 4: Single commit + push + create PR

After ALL docs are written:

### 4a. Commit all docs at once

```bash
git add docs-internal/
git status --porcelain
```

If there are changes:
```bash
git commit -m "$(cat <<'EOF'
docs: add documentation for TASK-ID-1, TASK-ID-2, ...
EOF
)"
```

**NEVER use `--allow-empty`**. If no files changed, skip.

### 4b. Push

```bash
git push
```

If push fails, retry once.

### 4c. Create PR (ready for review, NOT draft)

Read the branch name and PR URL from environment:
```bash
BRANCH=$(git branch --show-current)
PR_URL=${ALMIRANT_PR_URL:-}
PR_NUMBER=${ALMIRANT_PR_NUMBER:-}
```

If `ALMIRANT_PR_URL` is set, the PR already exists as draft. Mark it ready for review:
```bash
gh pr ready "$PR_NUMBER" 2>/dev/null || true
```

If no PR exists yet, create one:
```bash
gh pr create --title "docs: documentation for TASK-IDs" --body "$(cat <<'EOF'
## Documentation

Auto-generated documentation for:
- [TASK-ID-1] Title 1
- [TASK-ID-2] Title 2

## Files
- `docs-internal/product/changelog/TASK-ID-1-slug.md`
- `docs-internal/product/changelog/TASK-ID-2-slug.md`

---
Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

### 4d. Link commit to work items

```bash
SHA=$(git rev-parse HEAD)
```

For each documented task:
`link_commit_to_work_item(workItemId, sha, message, branch)`

## Step 5: Complete + move to Done

For each documented task, call `complete_documentation` (single atomic call):

```
complete_documentation(
  workItemId: "<UUID>",
  doneColumnId: "<from boardContext.columnMap.done>",
  documentTitle: "<from doc agent output>",
  documentContent: "<full markdown from doc agent>",
  documentCategoryId: "<optional>",
  screenshotUrls: [<urls from Step 1>],
  model: "<MODEL_USED_BY_SUBAGENT>",
  provider: ACTIVE_PROVIDER,
  totalTokens: <tokens>,
  durationMs: <duration>,
  taskId: "A-XXX"
)
```

**If fails**: Retry once. If still fails, leave in Release and add comment.

## Step 6: Parent promotion

Check `parentItems` from Step 0:

For each parent:
- Re-resolve children: `resolve_work_items(ids: [parentId], includeLeafTasks: true)`
- If ALL children in Done -> move parent to Done: `move_work_item(parentId, doneColumnId)`
- If SOME not Done -> report which block the parent.

## Step 7: Summary report

```
## Documentation Summary

**Input**: N work items | **Resolved tasks**: X
**Branch**: <branch name>
**PR**: <PR URL> (ready for review)
**Screenshots**: S captured
**Documented**: D tasks
**Completed**: C tasks moved to Done

### Results

| Task | Title | Screenshots | Doc | Status |
|------|-------|-------------|-----|--------|
| A-XX | "Title" | 2 | Yes | Done |
| A-YY | "Title" | 0 | Yes | Done |

### Completed tasks
- **A-XX**: [Summary]

### Skipped tasks
- **A-WW**: Column 'Validating' is not Release

### Parent items
- **A-F-XX**: 4/4 children in Done -> promoted to Done

### PR
- <PR URL> — ready for review
```

## Error Handling

- **Screenshots fail**: Skip silently, report a warning clearly
- **Doc generation fails**: Leave in Release, add comment, continue with others
- **`complete_documentation` fails**: Retry once, then leave and comment
- **Push fails**: Retry once, log error
- **Phase failures do NOT block other tasks**
