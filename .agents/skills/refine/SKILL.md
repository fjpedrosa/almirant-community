---
name: refine
description: Scope refinement for existing parent work items. Analyzes current scope, identifies gaps, and proposes modifications (expand existing tasks, update parent specs, or create new tasks only when genuinely needed).
argument-hint: <work-item-id>
---

# Refine Skill

You are helping the user **refine the scope** of an existing parent work item (epic, feature, or story) in Almirant. Unlike `/ideate` (which creates new work from scratch), `/refine` starts from an existing plan and modifies it based on new information, gaps discovered, or changed requirements.

## Progress Reporting (mandatory)

Report progress in natural language throughout execution. OpenClaw relays normal agent output and structured session events to Discord.

### Progress reporting

```
- Tell the user: Cargando work item y validando...
- Tell the user: Analizando scope actual: N children encontrados...
- Tell the user: Proponiendo cambios al scope...
- Tell the user: Ejecutando cambios aprobados...
- Final success example: Scope refinado: X items modificados, Y creados
- Failure example: <motivo si falla>
```

### Interactive questions (when running in a Discord thread)

When you need user input, ask in plain text instead of using the `AskUserQuestion` tool:

```
¿Qué necesita cambiar en el scope?

Opciones:
- Opción A — descripción
- Opción B — descripción
- Opción C — descripción

Luego detente y espera la respuesta del usuario.
```

After asking the question, STOP and wait for the user's response. Their reply will arrive as a new message in your session.

**How to detect Discord context**: If the task prompt contains "BIDIRECTIONAL DISCORD THREAD", you are running in a Discord thread. Ask in plain text instead of using `AskUserQuestion`.

Never skip the final outcome summary.

## Key Principles

1. **Modify before create** -- prefer expanding existing tasks over creating new ones.
2. **Preserve intent** -- changes should align with the parent's original purpose.
3. **Minimize disruption** -- avoid moving items between columns or changing assignments unless explicitly requested.
4. **Track changes** -- every modification creates an observation with action `"refined"` and supersedes the previous one.
5. **One parent at a time** -- focus on a single parent's scope per invocation.

## Process

### Phase 1: Resolve Parent

1. Parse `$ARGUMENTS`:
   - The input MUST be a valid work item ID (e.g., `A-F-403`, `MC-123`, `A-E-10`). Use `get_work_item(taskId)` to load it directly.
   - If the input does not look like a valid work item ID, respond immediately: *"El skill `/refine` requiere un work item ID explícito (ej: `A-F-403`, `MC-123`). Si no sabés qué item refinar, usá `/ideate` para explorar ideas contra el backlog o `list_work_items` manualmente primero."* Do NOT proceed further.
2. Validate the parent:
   - Must be an epic, feature, or story (not a task).
   - If the parent is completed (in a Done column), warn the user and confirm they want to proceed.
3. Load children: `list_work_items(parentId: parent.id)` to get all direct children.

**Output**: Present the parent and its children:

**Parent**: `{taskId}` -- {title} ({type}, {columnName})
> {description excerpt}

**Children** ({count}):

| # | ID | Type | Title | Status | Priority |
|---|---|---|---|---|---|
| 1 | A-123 | task | Title here | Backlog | medium |
| 2 | A-124 | task | Another task | In Progress | high |

**Definition of Done** (parent):
{parent's DoD or "Not specified"}

### Phase 2: Listen & Analyze

Ask the user: **"What needs to change? Describe what's missing, what changed, or what gap you found."**

Wait for the user's input via `AskUserQuestion`.

After receiving input, analyze the situation and classify into one or more actions:

| Action | When to use | MCP tool |
|---|---|---|
| **Expand existing task** | The gap is covered by an existing task's scope but its description/DoD needs updating | `update_work_item` |
| **Update parent specs** | The parent's description or DoD needs to reflect new understanding | `update_work_item` |
| **Redistribute scope** | Work should move from one child to another | `update_work_item` on both |
| **Create new task** | Genuinely new work that no existing task covers | `create_task` |
| **Split a task** | An existing task is too large and should become multiple tasks | `update_work_item` + `create_task` |

### Phase 3: Propose Changes

Present the proposed changes clearly using markdown (NOT code blocks):

**Proposed changes:**

**1. Expand task A-123: "Original title"**

- **Description change**: Add section about [X] under "Que hay que hacer"
- **DoD change**: Add criterion "- [ ] New criterion here"
- **Rationale**: This task already handles [Y], adding [X] is a natural extension

**2. Update parent A-F-403 specs**

- **Description change**: Add mention of [Z] in context section
- **Rationale**: Parent description should reflect the broadened scope

**3. Create new task** (only if genuinely new work)

- **Title**: "Implementar [new thing]"
- **Description**: Full 4-section description following project conventions
- **Rationale**: No existing task covers this; it's genuinely new work
- **Agent hint**: backend-architect
- **Estimated points**: 3

Ask the user: **"Do you approve these changes? You can modify, add, or remove any of them."**

Wait for explicit approval via `AskUserQuestion`.

### Phase 4: Execute Changes

After the user approves, execute all changes:

1. **For each modified work item** (`update_work_item`):
   - Apply the description/DoD/metadata changes
   - Record an observation:
     a. Search for existing observations: `workitem_search(query: "taskId", workItemType: type)`
     b. Create new observation: `workitem_save(topicKey: "{taskId-slug}-refined", title: "Scope refined: {brief}", workItemId: UUID, taskId: taskId, workItemType: type, action: "refined", description: "what changed", rationale: "why it changed", affectedFiles: [], decisions: [list of decisions], learnings: [], projectId: projectId)`

2. **For new tasks** (`create_task`):
   - Create with full metadata (description with 4 sections, DoD, agentHints, estimatedPoints)
   - Set parentId to the current parent
   - Use the board and column from the parent's board context
   - Record observation with action `"created"`

3. **For each observation** where a previous one exists:
   - The `workitem_save` call with the same topicKey will automatically update via the upsert mechanism

### Phase 5: Report

Present a summary of all changes made:

**Scope refinement complete for {parent taskId}: "{parent title}"**

| # | Action | Item | What changed |
|---|---|---|---|
| 1 | Expanded | A-123 | Added [X] to description and DoD |
| 2 | Updated | A-F-403 | Updated parent description |
| 3 | Created | A-125 | New task: "Title" (3 pts) |

**Total**: X items modified, Y items created

---

## Quality Checklist

Before executing any change, verify:

- [ ] Modifications align with the parent's original intent
- [ ] Existing tasks are expanded rather than duplicated
- [ ] New tasks (if any) have full 4-section descriptions
- [ ] New tasks have DoD, agent hints, and estimated points
- [ ] All changes have clear rationale
- [ ] Observations are recorded for every modified item

## Anti-patterns to Avoid

- **Don't create tasks when you can expand** -- always check if an existing task covers the scope.
- **Don't modify tasks in Done/Reviewing/Validating/Release** -- warn the user if a task has already left Backlog.
- **Don't change task assignments** -- scope refinement is about content, not ownership.
- **Don't rewrite entire descriptions** -- make targeted additions/modifications.
- **Don't skip user approval** -- always present changes and wait for explicit approval.
- **Don't create empty parents** -- if the user wants a new grouping, suggest using `/ideate` instead.

<!-- runner-runtime-mcp-fallback -->
## Runner Runtime Note

In this Claude runner environment, Almirant MCP may be configured in `.mcp.json` without appearing in `ToolSearch` or the deferred tool list.
If that happens, do not conclude that MCP access is missing.

Before reporting missing Almirant MCP access:

1. Read `.mcp.json` and extract `mcpServers.almirant.url` and `mcpServers.almirant.headers.Authorization`.
2. Call JSON-RPC `tools/list` against that HTTP endpoint to confirm the available tool names.
3. Call JSON-RPC `tools/call` for the needed Almirant tool.
4. Only report MCP unavailable if `.mcp.json` has no `almirant` entry or the HTTP call itself fails.

Example discovery command:

```bash
MCP_URL=$(jq -r '.mcpServers.almirant.url // empty' .mcp.json)
AUTH=$(jq -r '.mcpServers.almirant.headers.Authorization // empty' .mcp.json)
curl -s -X POST "$MCP_URL" \
  -H "Authorization: $AUTH" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Example tool call:

```bash
curl -s -X POST "$MCP_URL" \
  -H "Authorization: $AUTH" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_work_items","arguments":{}}}'
```
