---
name: pr
description: Create or update a Pull Request from the current branch, auto-generating a rich description from associated work items and commits.
argument-hint: "[work-item-id] [--draft]"
---

# PR Skill

Create or update a GitHub Pull Request for the current branch, with an auto-generated description based on work items and commits.

## Step 1: Detect current branch

```bash
git branch --show-current
```

If the branch is `main` or `master`, tell the user: "You are on the main branch. Switch to a feature branch first." and **stop**.

## Step 2: Extract work item ID

### From argument (if provided)

If `$ARGUMENTS` contains a work item ID (matches `MC-[EFS]?-?\d+`), use that ID.

### From branch name (fallback)

Extract the work item ID from the branch name using regex:

```
/MC-[EFS]?-?\d+/i
```

Examples:

- `feature/MC-F-42-pr-skill` → `MC-F-42`
- `epic/MC-E-19-git-branch-strategy` → `MC-E-19`
- `task/MC-568-branch-creation` → `MC-568`
- `implement/MC-568-MC-571` → `MC-568` (first match)

If no ID can be extracted, warn the user but continue — the PR can still be created without work item context.

### Parse flags

Check if `$ARGUMENTS` contains `--draft`. If so, set `IS_DRAFT = true`.

## Step 3: Gather context

### 3a. Commits on the branch

```bash
git log main..<branch> --oneline --no-decorate
```

If no commits found, tell the user: "No commits found on this branch relative to main. Nothing to PR." and **stop**.

### 3b. Extract ALL work item IDs

Collect work item IDs from **multiple sources** (deduplicated):

1. **Branch name**: Extract using regex `/MC-[EFS]?-?\d+/gi` (may yield multiple IDs)
2. **Commit messages**: Scan all commit messages for the same pattern (e.g. `feat(MC-568): ...`)
3. **Argument** (from Step 2): Include if provided

Combine all unique IDs into a single list. This ensures PRs that implement multiple tasks reference all of them.

### 3c. Work item info

If any IDs were found, resolve them via MCP:

```
resolve_work_items(ids: ["MC-568", "MC-571", ...])
```

For each resolved work item, extract: `id` (UUID), `title`, `type`, `priority`, `description` (first 200 chars), `taskId`.

Additionally, extract implementation metadata fields if present:

- `codingAgent`: The coding agent used (e.g., `"codex"`, `"claude-code"`, `"open-codec"`)
- `aiModel`: The AI model actually used by the subagent (e.g., `"actual-subagent-model"`, `"gpt-5"`)
- `requestedByUserId`: UUID of the user who requested the implementation

For `requestedByUserId`, resolve the user name using the `requestedByUser` relation data from the MCP response. If not available, call `list_members` to resolve the UUID to a display name. If resolution fails, use the UUID as fallback.

If the primary ID (from branch name) is a feature or epic with children, also gather children titles and statuses.

### 3d. Changed files

```bash
git diff main..HEAD --stat
```

Parse the output to get a list of changed files with their modification counts. Group them by top-level directory:

- `frontend/` → Frontend
- `backend/` → Backend
- `.claude/` → Configuration
- Everything else → Other

## Step 4: Generate PR title

Format: `[MC-XXX] Work item title`

If no work item found, use the branch name slug as title:

```
branch-name → "Branch: branch-name"
```

## Step 5: Generate PR body

Construct the body using the template below. The Almirant frontend URL for linking work items is: `https://app.almirant.io` (or `NEXT_PUBLIC_APP_URL` if available).

Work item links use the format: `https://app.almirant.io/boards/<boardId>?item=<workItemId>`

### Body template

```markdown
## Summary

[2-3 sentences synthesized from the work item descriptions and commit messages.
Focus on WHAT changed and WHY, not individual file changes.
Example: "Implements git branch strategy for the implement skill, adding automatic branch creation,
conventional commits per task, and a new /pr skill for PR management."]

## Work Items

- [[MC-XXX] Title](https://app.almirant.io/boards/<boardId>?item=<workItemId>) — type, priority
- [[MC-YYY] Title](https://app.almirant.io/boards/<boardId>?item=<workItemId>) — type, priority

## Implementation Details

| Work Item | Requested by | Coding Agent | AI Model |
|-----------|--------------|--------------|----------|
| [MC-XXX] Title | User Name | Claude Code | actual-subagent-model |
| [MC-YYY] Title | User Name | Codex | gpt-4o |

## Changes

**Frontend** (N files)
- `path/to/file.tsx` — brief description inferred from commit or file name

**Backend** (N files)
- `path/to/file.ts` — brief description

**Configuration** (N files)
- `.claude/skills/...` — brief description

## Commits

- `abc1234` feat(MC-568): Add branch creation to implement skill
- `def5678` feat(MC-571): Add PullRequestRef types and auto-linking

## Test Plan

- [ ] TypeScript compiles without errors (`bun run type-check`)
- [ ] ESLint passes without warnings (`bun run lint`)
- [ ] [Feature-specific verification step based on work item DoD]

---
Generated with [Claude Code](https://claude.ai/claude-code)
```

### Guidelines for body generation

- **Summary**: Synthesize from work item descriptions — do NOT just list commits. Write 2-3 human-readable sentences.
- **Work Items**: Include clickable links to Almirant. If the work item UUID or boardId is not available, use just the task ID without a link.
- **Implementation Details**: Include this section only if at least one work item has `codingAgent`, `aiModel`, or `requestedByUserId` populated. Guidelines:
  - **Visibility**: Omit the entire section if no work item has any of the 3 fields set
  - **Coding Agent display names**: Map enum values to display names: `"codex"` → `"Codex"`, `"claude-code"` → `"Claude Code"`, `"open-codec"` → `"Open Codec"`
  - **Requested by**: Use the user's display name, not UUID. If the name cannot be resolved, use the UUID as fallback
  - **Empty cells**: If a field is null for a specific work item, leave that cell empty (do not write "N/A" or similar)
  - **Table format**: Always use the table format even for a single work item for consistency
- **Changes**: Group files by top-level directory. For each file, infer a brief description from the commit message that modified it or from the file name itself. Limit to ~10 most important files if there are many.
- **Commits**: Copy directly from `git log` output, formatted as bullet points.
- **Test Plan**: Always include type-check and lint. Add 1-2 feature-specific checks based on the work item's definition of done.
- **Length**: Keep body under 2000 characters ideally. If too long, truncate the Changes section (show top 10 files + "and N more").

## Step 6: Push branch if needed

Check if branch is pushed:

```bash
git ls-remote --heads origin <branch-name>
```

If not found on remote:

```bash
git push -u origin <branch-name>
```

## Step 7: Create or update PR

### Check if PR already exists

```bash
gh pr view --json url,number 2>/dev/null
```

### If PR exists → update

```bash
gh pr edit --title "<title>" --body "$(cat <<'EOF'
<generated body>
EOF
)"
```

Report: "PR updated: <url>"

### If PR does not exist → create

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<generated body>
EOF
)" [--draft if IS_DRAFT]
```

Report: "PR created: <url>"

## Step 8: Link PR to work item

If a work item ID was found, update the work item metadata with the PR reference:

```
update_work_item(id: "<work-item-uuid>", metadata: {
  pullRequest: {
    url: "<pr-url>",
    number: <pr-number>,
    state: "open",
    branch: "<branch-name>"
  }
})
```

## Step 9: Report

```
PR [created|updated]: <url>
Branch: <branch-name>
Work Item: MC-XXX — "Title"
Commits: N
Files changed: M
```
