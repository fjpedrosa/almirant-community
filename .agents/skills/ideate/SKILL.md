---
name: ideate
description: Interactive brainstorming that transforms a rough idea into deeply researched, well-structured work items (epic > feature > story > task) in Almirant.
argument-hint: <rough idea, problem statement, or area to explore>
---

# Ideate Skill

## Progress Reporting (mandatory)

Report progress in natural language throughout execution. OpenClaw relays normal agent output and structured session events to Discord.

### Progress reporting

```
- Tell the user: Investigando el problema: <tema>...
- Tell the user: Analizando codebase relacionado...
- Tell the user: Proponiendo estructura: 1 épica, N features, M stories...
- Tell the user: Creando work items en Almirant...
- Final success example: Planificación completa: Épica A-E-XX creada con N features
- Failure example: <motivo si falla>
```

### Interactive questions (when running in a Discord thread)

When you need user input, ask in plain text instead of using the `AskUserQuestion` tool:

```
¿Qué enfoque prefieres para X?

Opciones:
- Opción A — descripción
- Opción B — descripción
- Opción C — descripción

Luego detente y espera la respuesta del usuario.
```

After asking the question, STOP and wait for the user's response. Their reply will arrive as a new message in your session.

**How to detect Discord context**: If the task prompt contains "BIDIRECTIONAL DISCORD THREAD", you are running in a Discord thread. Ask in plain text instead of using `AskUserQuestion`.

Never skip the final outcome summary.

## Session Resumption

When you receive `<session_recovery>` context, you are resuming an interrupted session. Follow these rules strictly:

1. Read the recovery summary to understand the current state (seeds, work items created, last phase).
2. Read the `<previous_conversation>` to understand the full dialogue history.
3. **Resume from the EXACT phase indicated in the recovery context**, not from Phase 1. For example, if `lastPhase` is `"awaiting_user"` and 0 work items were created, the user was likely in Phase 3 (brainstorming). If work items were already created, you were in Phase 6 (consolidation).
4. If work items were already created, do NOT recreate them — acknowledge them and continue.
5. If a pending question exists in the recovery context, re-ask it.
6. Greet the user briefly, summarize where you left off, and continue the conversation naturally.

---

You are helping the user transform a **rough idea** into deeply researched, well-structured work items in Almirant. Unlike `/create-tasks` (which structures already-clear requirements), `/ideate` starts from ambiguity and drives toward clarity through brainstorming, technical research, and iterative refinement.

## Key Principles

1. **Brainstorming first, structuring later** -- understand the problem space before proposing solutions.
2. **Deep technical research informs every task** -- every task includes affected files, reference patterns, and implementation hints discovered through codebase analysis.
3. **Iterative refinement** -- present options, challenge assumptions, converge through dialogue.
4. **Tasks are what matters** -- epics, features, and stories are organizational labels. Tasks contain the actual work.
5. **Quality over quantity** -- fewer well-defined tasks with rich technical context beat many vague ones.

## Hierarchy Rules

- **Epic** groups features, stories, and tasks. Represents a large initiative or theme.
- **Feature** groups stories and tasks. Represents a specific capability or deliverable.
- **Story** groups tasks. Represents a user-facing scenario or workflow.
- **Task** is the atomic unit of work. Contains the actual implementation details.
- Tasks CAN exist without a parent (standalone tasks are fine).

## Board Rules

- Resolve board/column configuration dynamically from `get_ideation_context` (`boards[].columnMap`).
- Do not hardcode board IDs, column IDs, or project ID in this skill.

## Process

### Phase 1: Capture & Understand

1. Read the user's input (`$ARGUMENTS`) as the raw idea.
2. **Classify idea maturity:**
   - **Spark** (very vague, 1-2 words or abstract concept): Ask 3-5 clarifying questions:
     - What specific problem are we solving?
     - Who are the target users/personas?
     - What's the desired scope? (quick win, medium feature, large initiative)
     - Any known constraints? (tech stack, timeline, dependencies)
     - What does success look like?
   - **Concept** (has some shape but needs focus): Ask 1-2 targeted questions to narrow scope.
   - **Defined** (clear problem + general direction): Confirm understanding and proceed.
3. Use `AskUserQuestion` for the clarifying questions.
4. **Output**: Write a **Problem Statement** (2-3 sentences: what problem, who it affects, why it matters).
5. **Skip**: If the user says "skip questions" or similar, proceed with your best interpretation of their input and state your assumptions explicitly.

### Phase 2: Board Research

Search for existing work items and potential parents in a single context call.

1. Build keywords derived from the idea.
2. Call `get_ideation_context(keywords: [...])`.
3. Read `relatedItems`, `potentialParents` _(deprecated)_, and `potentialRefinements` from the response.
   - **`potentialRefinements`** (new, preferred): Unifies the old `potentialParents` concept with standalone Backlog tasks. Returns epics, features, stories, AND standalone tasks (tasks with no parent) that are in Backlog status. Each item includes `type`, `hasChildren`, and `childCount`.
   - **`potentialParents`** (deprecated): Still returned for backward compatibility but no longer used by this skill. When all runners are updated, `potentialParents` will be removed (tracked in a separate backend task).
4. For each relevant item found, note:
   - ID, title, type, status
   - Relationship: overlaps / complements / conflicts with the idea
5. **Present findings in two separate sections** (NEVER mix these lists into a single table):

   **Related items (context, N)** — read-only context from `relatedItems`. N must equal `relatedItems.length`.

   | ID | Type | Title | Status | Relationship |
   |---|---|---|---|---|
   | MC-XXX | feature | Title | In Progress | Overlaps with [aspect] |
   | MC-XXX | task | Title | Done | Already covers [aspect] |

   **Refinable items in Backlog (M)** — actionable items from `potentialRefinements`. M must equal `potentialRefinements.length`.

   | ID | Type | Title | hasChildren | Children |
   |---|---|---|---|---|
   | MC-XXX | epic | Title | yes | 3 |
   | MC-XXX | task | Title | no | 0 |

   **Rule**: Items from `relatedItems` are context only — they CANNOT be selected as parents or refinement targets. Items from `potentialRefinements` are the only actionable items. Never narrate items from one list using counts or descriptions that belong to the other.

6. **Choose a path** — two options only:

   - **Path 1 — Refine existing item**: Select one of the items from `potentialRefinements` and enter Phase 2b. This unifies the old concepts of "scope refinement under parent" and "refine standalone item" into a single action. Phase 2b handles internal branching by item type (parent with children / parent without children / standalone task).
   - **Path 2 — Standalone new**: Proceed to Phase 3 with no parent and no refinement. Always available.

   **Dynamic behavior:**

   - If `potentialRefinements.length === 0`: **auto-advance to Path 2** without asking. Report to the user: _"No refinable items found in Backlog — proceeding as standalone initiative."_ and go directly to Phase 3 with `parent = null`.
   - If `potentialRefinements.length > 0`: use `AskUserQuestion` with dynamic `options`:
     - One option per item in `potentialRefinements`:
       - `label: "Refinar <taskId>"` (e.g. `"Refinar A-1718"`)
       - `description`: brief summary — `"<type>, <standalone|N children>, Backlog"` (e.g. `"task, standalone, Backlog"` or `"feature, 3 children, Backlog"`)
     - One final fixed option:
       - `label: "Standalone nuevo"`
       - `description: "Crear trabajo sin parent ni refinement"`

   **Never render "not available" lines.** If a rule does not apply (e.g., no refinable items), simply omit. If all options other than standalone are inapplicable, auto-advance as described above.

   **Eligibility rule**: Only items from `potentialRefinements` (Backlog status) are eligible for Path 1. The `relatedItems` list is shown for context only and its items CANNOT be selected.

7. **Skip**: If the user says "fresh start" without selecting an item, treat it as Path 2 and continue.

### Phase 2b: Scope Refinement (when Path 1 is chosen)

When the user selects an existing item for scope refinement, perform a lightweight analysis before brainstorming. This avoids creating duplicate or overlapping work items.

**This is a lighter version of the standalone `/refine` skill, integrated into the ideation flow.**

1. **Entry guard**: Before proceeding, validate that the selected item exists in the `potentialRefinements` list from Phase 2. If the selected item is NOT in `potentialRefinements` (i.e., it is not in Backlog status), STOP immediately. Inform the user that only Backlog items from `potentialRefinements` are eligible, and redirect to Path 2 — proceed to Phase 3 with no parent context.

2. **Branch by item type and children**:

   **Branch A — Epic/Feature/Story with `hasChildren=true`** (Path 1 with a parent-type item that has children):
   This is the standard scope refinement flow. Proceed to step 3.

   **Branch B — Epic/Feature/Story with `hasChildren=false`** (Path 1 with a parent-type item that has NO children):
   The parent exists but has no children yet. Skip the scope comparison and proceed directly to Phase 3 with this item set as the parent. Report: _"Parent {taskId} has no existing children — proceeding to brainstorm new work under it."_

   **Branch C — Standalone task** (Path 1 with a standalone task):
   Compare the idea directly against this task's description and DoD. Do NOT load children (standalone tasks don't have children in this context). Go to step 3c below.

3. **Load details and compare** (only for Branch A and Branch C):

   **For Branch A (parent with children):**

   a. Call `get_work_item(parentId)` to retrieve the full parent (description, DoD, metadata).
   b. Call `list_work_items(parentId: parentId)` to get all children under this parent.
   c. Present current scope to the user:

      **Parent**: `{taskId}` -- {title} ({type}, {status})
      > {description excerpt -- first 2-3 sentences}

      **Existing children** ({count}):

      | # | ID | Type | Title | Status | Pts |
      |---|---|---|---|---|---|
      | 1 | MC-XXX | task | Title | Backlog | 3 |
      | 2 | MC-XXX | task | Title | In Progress | 5 |

   d. Compare the user's idea with existing children. Classify using the **Backlog-only modification rule** (step 4).

   **For Branch C (standalone task):**

   a. Call `get_work_item(taskId)` to retrieve the full task (description, DoD, metadata).
   b. Present the task to the user:

      **Task**: `{taskId}` -- {title} ({type}, {status})
      > {description excerpt}

      **Definition of Done**: {DoD or "Not specified"}

   c. Compare the idea against this task's description and DoD. Classify:
      - **Already covered**: The task's description and DoD already cover the idea fully. Recommend expanding/refining the description or DoD if minor additions would help, otherwise report no new work needed.
      - **Partially covered**: Some aspects match but gaps remain. Propose expanding the task's description and/or DoD to cover the matched parts, then carry forward uncovered aspects to Phase 3 as standalone new work (no parent — this was already a standalone task).
      - **Completely new**: The idea is unrelated to this task. Redirect to Path 2 — proceed to Phase 3 with no parent context.

4. **Backlog-only modification rule** (applies to Branch A children):

   Only children whose `columnName` is exactly `"Backlog"` may be proposed for modification (expanding description, updating DoD, etc.). Children in any other status (In Progress, Reviewing, Validating, Release, Done) are **read-only context** and MUST NOT be proposed for modification. Items with a null, empty, or missing `columnName` (i.e., null `boardColumnId`) are also treated as non-Backlog and are read-only.

   Apply these categories considering the Backlog-only rule:

   - **Already covered**: A Backlog child task fully covers the idea. Recommend expanding that task's description/DoD instead of creating new work. Propose the specific changes (description additions, new DoD criteria). If the covering child is NOT in Backlog, classify as **Completely new** instead — do not propose modifying it.
   - **Partially covered**: Some aspects are handled by existing children, but gaps remain. For covered parts where the existing child IS in Backlog, recommend expanding that child. For covered parts where the existing child is NOT in Backlog, treat the overlap as new work — do NOT propose modifying the non-Backlog child. Note what genuinely new work is needed for Phase 3.
   - **Completely new**: No existing Backlog child covers this idea (even if a non-Backlog child overlaps, this is still classified as new). Note that the parent is a good home for the new work and proceed to Phase 3.

5. **Present the analysis** as a summary:

   **Scope analysis for idea: "{idea summary}"**

   | Aspect of idea | Coverage | Existing item | Item status | Recommended action |
   |---|---|---|---|---|
   | [aspect 1] | Covered | MC-XXX | Backlog | Expand task MC-XXX (add [detail] to description) |
   | [aspect 2] | Overlap (read-only) | MC-YYY | In Progress | New task needed (MC-YYY is not in Backlog — cannot modify) |
   | [aspect 3] | New | -- | -- | Create new task in Phase 3 |

6. **If modifications are needed** (covered or partial aspects with Backlog items):
   - Propose specific changes to existing Backlog items only (description additions, DoD updates).
   - Ask the user: **"Do you approve these changes to existing items? Then we will continue to brainstorm the remaining new work."**
   - Wait for explicit approval.
   - Execute approved changes via `update_work_item`.
   - Record observations with `workitem_save(action: "refined")` for each modified item.

7. **Transition to Phase 3**:
   - If ALL aspects are already covered by Backlog items and the user approves the modifications: Report "Scope fully covered by existing items. No new work needed." and end.
   - If there are new or partially-new aspects (including aspects that overlap with non-Backlog children): Carry forward the "what is NOT yet covered" context into Phase 3 as input for brainstorming. The parent is set (for Branch A) or no parent (for Branch C, since standalone tasks don't become parents).
   - Phase 3 should only brainstorm the **uncovered portions**, not the entire idea.

### Phase 3: Brainstorming & Iteration

This is the creative core of the skill. Engage in structured brainstorming with the user.

1. **Generate 3-5 high-level approaches** to solve the problem. For each approach:
   - Name and 1-line summary
   - Pros (2-3 bullets)
   - Cons (2-3 bullets)
   - Estimated scope (S/M/L)
   - Key integration points with existing system

2. **Challenge assumptions** proactively:
   - "Have you considered...?"
   - "What happens when [edge case]?"
   - "Could we achieve 80% of the value with [simpler approach]?"
   - "This overlaps with [existing feature] -- should we extend it instead?"

3. **Iterate**: Default 2 rounds of refinement. Up to 4 rounds if the user wants to explore further. Each round:
   - User picks/combines/modifies approaches
   - You refine and present updated options
   - Narrow down progressively

4. **Converge** on a **Scope Statement** using bullet points (NOT code blocks):

   **Scope Statement:**
   - **WHAT we will do**: [specific deliverables]
   - **What we will NOT do**: [explicit exclusions]
   - **MVP vs Full**: [what's MVP, what's future]
   - **Integration points**: [existing systems/features affected]

5. **User confirms the scope** before proceeding to research. Do NOT proceed without explicit confirmation.

### Phase 4: Deep Technical Research

Launch specialized agents to map the codebase and inform task creation. This is what differentiates `/ideate` from `/create-tasks`.

#### Agent selection and launch

Launch agents in **parallel** based on what the scope touches:

| Research need | Agent (`subagent_type`) | Model param | When to launch |
|---|---|---|---|
| Map files, patterns, gaps | `technical-researcher` | _(inherit)_ | **Always** |
| Frontend DDD analysis | `frontend-clean-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When scope touches frontend |
| Backend routes, services | `backend-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When scope touches backend/API |
| DB schema, migrations | `database-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When scope involves data model changes |

After parallel agents complete, launch **sequentially** if needed:

| Research need | Agent (`subagent_type`) | Model param | When to launch |
|---|---|---|---|
| Complex task decomposition | `task-decomposition-expert` | _(inherit selected session model -- do NOT pass `model`)_ | When scope is complex (3+ features) |

#### Context to provide each agent

Every agent receives:

- **Problem Statement** (from Phase 1)
- **Scope Statement** (from Phase 3)
- **Related board items** (from Phase 2, if any)
- **Specific focus area** relevant to their expertise

Example prompts:

```
Task tool (technical-researcher):
  description: "Research codebase for [topic]"
  prompt: |
    Problem: [Problem Statement]
    Scope: [Scope Statement]
    Related items: [list from Phase 2]

    Explore the Almirant codebase to map:
    1. Files and modules related to [topic]
    2. Patterns currently used (hooks, components, routes, repos)
    3. Gaps -- what doesn't exist yet that we'd need to create
    4. Dependencies on existing code
    5. Reference implementations to follow (similar features already built)

    Return structured findings with specific file paths and code patterns.

Task tool (frontend-clean-architect, inheriting the current session model):
  description: "Analyze frontend architecture for [topic]"
  prompt: |
    Problem: [Problem Statement]
    Scope: [Scope Statement]

    Analyze the frontend architecture for implementing [topic]:
    1. Which domains in frontend/src/domains/ are affected?
    2. What hooks, components, and containers exist vs need creation?
    3. DDD compliance: types in domain/, hooks in application/, UI in presentation/
    4. Cross-domain dependencies at hook level
    5. React Query key structure for new data flows
    6. Form handling patterns if forms are involved

    Return actionable findings with file paths.
```

#### Synthesize findings

After all agents return, compile a **Technical Analysis** summary as a markdown table (NOT a code block):

| Area | Findings |
|---|---|
| **Frontend** | [domains affected, components to create/modify, hooks needed] |
| **Backend** | [routes to add/modify, services, middleware] |
| **Database** | [schema changes, new tables/columns, migrations] |
| **Dependencies** | [existing features this relies on] |
| **Risks** | [potential breaking changes, performance concerns] |
| **Reference** | [similar existing features to follow as patterns] |

Present this to the user. This is **informative** -- it does not require approval, just awareness before structuring tasks.

### Phase 5: Structure & Propose

Build the complete work item hierarchy using insights from all previous phases.

**CRITICAL FORMATTING RULE**: NEVER use triple-backtick code blocks for task descriptions, proposals, summaries, or any user-facing content. Use markdown headers, bold, lists, tables, and inline code instead. Code blocks are ONLY for actual code snippets.

#### Determine hierarchy depth

- **1 epic + features + tasks**: Large initiative (5+ features)
- **1 feature + tasks**: Medium scope (2-4 related tasks)
- **Standalone tasks**: Small scope (1-3 independent tasks)
- **1 feature + stories + tasks**: When user-facing workflows need story-level grouping

#### Build each work item

**For Epics:**

- Title: Descriptive noun phrase (e.g., "Sistema de notificaciones en tiempo real")
- Description: Business context + scope + success criteria
- Priority: Based on business impact

**For Features:**

- Title: Specific capability (e.g., "Notificaciones push via WebSocket")
- Description: Measurable outcomes + what's included/excluded

**For Stories:**

- Title: "Como [role], quiero [action] para [benefit]"
- Description: User scenario + acceptance criteria

**For Tasks (the most detailed):**

- **Title**: Imperative verb form, specific (e.g., "Implementar WebSocket connection manager en frontend")
- **Description** with 4 mandatory sections:

**IMPORTANT: Write task descriptions as regular markdown (headers, lists, inline code). NEVER wrap the description in a code block (triple backticks). The frontend renders markdown natively.**

The description MUST have these 4 sections as markdown headers:

**## Contexto** — Why this task exists (2-3 sentences linking to parent goal)

**## Que hay que hacer** — Specific steps as a bullet list

**## Archivos afectados** — File paths with inline code and what changes

**## Patron de referencia** — Existing file to follow as pattern

**## Consideraciones tecnicas** — Constraints and edge cases

- **Definition of Done** (`metadata.definitionOfDone`): 3-8 verifiable criteria, always including:

  ```
  - [ ] TypeScript compila sin errores
  - [ ] ESLint pasa sin warnings
  ```

- **Agent hints** (`metadata.agentHints`): From the agent hints table below
- **Estimated points** (`metadata.estimatedPoints`): Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Priority**: `low`, `medium`, `high`, or `urgent`
- **parentId**: Link to feature/story if applicable

#### Agent hints table

| Task content | Recommended `agentHints` value |
|---|---|
| Frontend components, hooks, UI | `"frontend-developer"` |
| Frontend architecture, DDD compliance | `"frontend-clean-architect"` |
| Backend routes, services, middleware | `"backend-architect"` |
| Database schema, repositories, migrations | `"database-architect"` |
| Pure TypeScript logic, utilities | `"javascript-pro"` |
| UI/UX design decisions | `"ui-ux-designer"` |
| Full-stack (frontend + backend) | `"frontend-developer, backend-architect"` |
| Full-stack + DB | `"frontend-developer, backend-architect, database-architect"` |

#### Present the proposal

Show the full structure as a **markdown table** (NEVER use code blocks for this):

| # | Type | Title | Parent | Priority | Pts | Agent Hint | Blocked by |
|---|------|-------|--------|----------|-----|------------|------------|
| -- | epic | [Title] | -- | high | -- | -- | -- |
| 1 | feature | [Title] | epic | high | -- | -- | -- |
| 2 | task | [Title] | feature | medium | 3 | frontend-developer | -- |
| 3 | task | [Title] | feature | medium | 5 | backend-architect | Task 2 |

**Total**: X items, NN total points

**Dependencies**:

- Task "[Title X]" → blocked by Task "[Title Y]" (reason)
- Task "[Title Z]" → blocked by Task "[Title W]" (reason)

#### Identify dependencies

After building the hierarchy, analyze task relationships and identify blocking dependencies between tasks in the **same batch**. A dependency means task A cannot start until task B is done (e.g., DB schema before repository, API route before frontend hook).

Show dependencies as part of the proposal (as markdown list, NOT code block):

**Dependencies:**

- Task "Implementar repositorio de X" → blocked by Task "Crear schema de X" (needs DB schema before repository can use it)
- Task "Crear hook useX en frontend" → blocked by Task "Implementar endpoint GET /api/x" (needs API before frontend can consume it)

If no meaningful dependencies exist, state "No dependencies identified" and move on.

**Ask the user** for approval with options:

- Approve as-is
- Modify items (add/remove/change)
- Change priorities or estimates
- View full detail of a specific task
- Go back to brainstorming (Phase 3)

**Iterate** until the user explicitly approves.

### Phase 6: Consolidation

Create all approved work items in Almirant.

#### Creation order (sequential for parentId linking)

1. **Epics** first (on Product Roadmap board)
2. **Features** (on Product Roadmap board, with `parentId` = epic)
3. **Stories** (on Product Roadmap board, with `parentId` = feature)
4. **Tasks** last (on Desarrollo board, with `parentId` = feature/story)
5. **Create dependencies** between tasks:
   - For each dependency identified in Phase 5:
     - Call `add_work_item_dependency(workItemId: blockedTaskId, blockedByWorkItemId: blockingTaskId)`
     - Log: `"Dependency created: MC-XXX blocked by MC-YYY"`
   - If a call fails (e.g. circular dependency, duplicate edge), log the error and continue with remaining dependencies.

#### MCP tools to use

- `create_epic` for epics
- `create_feature` for features
- `create_story` for stories
- `create_task` for tasks
- `add_work_item_dependency` for task dependencies

#### Task metadata structure

```json
{
  "definitionOfDone": "- [ ] Criterion 1\n- [ ] Criterion 2\n- [ ] TypeScript compila sin errores\n- [ ] ESLint pasa sin warnings",
  "agentHints": "frontend-developer",
  "estimatedPoints": 5,
  "technicalContext": "Reference: path/to/reference-file.ts\nPattern: [pattern name]"
}
```

#### Error handling

- If creating a parent item fails, **skip all its children** and report the failure.
- If creating a task fails, log it and continue with remaining tasks.
- At the end, report any failures clearly.

#### Present summary

After all items are created, show a final summary as a **markdown table** (NOT a code block):

**Items creados:**

| ID | Type | Title | Parent | Priority | Pts | Agent Hint | Blocked by |
|---|------|-------|--------|----------|-----|------------|------------|
| MC-XXX | epic | ... | -- | high | -- | -- | -- |
| MC-XXX | feature | ... | MC-XXX | high | -- | -- | -- |
| MC-XXX | task | ... | MC-XXX | medium | 5 | frontend-developer | MC-XXX |
| MC-XXX | task | ... | MC-XXX | medium | 3 | backend-architect | -- |

**Total**: X items created (Y epics, Z features, W tasks), NN total points

#### Save planning memory

After all work items are created, persist the planning context for future reference. This is best-effort -- if a call fails, log a warning and continue.

**For each work item created**, call `workitem_save`:

```
workitem_save(
  topicKey: "<taskId-slug>-planning",            // e.g. "mc-e-12-planning"
  title: "Planned: <work item title>",
  workItemId: "<UUID>",                          // the created work item UUID
  taskId: "<TASK-ID>",                           // e.g. "MC-E-12"
  workItemType: "<epic|feature|story|task>",
  action: "created",
  description: "<problem being solved, scope decisions, what this item will deliver -- 2-3 sentences>",
  rationale: "<why this approach/scope was chosen over alternatives>",
  decisions: ["<key architectural/scope decisions from the research phase>"],
  learnings: ["<technical findings from the deep research (frontend, backend, DB)>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the Phase 3 scope statement, Phase 4 technical research findings, and the Phase 5 proposal. The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-planning`.

**If seeds were used** in the ideation (i.e., the idea originated from or incorporated seeds), also call `seed_save` for each seed:

```
seed_save(
  topicKey: "<seed-slug>-promoted",              // e.g. "websocket-notifications-promoted"
  title: "Seed promoted: <seed title>",
  seedId: "<seed UUID>",
  action: "promoted",
  description: "<what the seed captured and how it evolved into work items>",
  rationale: "<why this seed was chosen for implementation>",
  promotedToWorkItemId: "<the epic/feature work item UUID>",
  projectId: "<project UUID from context>"
)
```

Derive the seed slug from the seed title (lowercased, spaces replaced by hyphens). Only call `seed_save` for seeds that were explicitly used or referenced during the ideation process.

## Task Quality Checklist

Before creating any task, verify:

- [ ] Title uses imperative form and is specific
- [ ] Description has all 4 sections (Contexto, Que hay que hacer, Archivos afectados, Patron de referencia)
- [ ] Description explains WHY (Contexto) and WHAT specifically (Que hay que hacer)
- [ ] Affected files list includes specific paths discovered during research
- [ ] Reference pattern points to an existing file in the codebase
- [ ] Definition of Done has 3-8 specific, verifiable criteria
- [ ] Definition of Done includes TypeScript + ESLint checks for code tasks
- [ ] Estimated points use Fibonacci scale (1, 2, 3, 5, 8, 13)
- [ ] Priority reflects actual urgency/impact
- [ ] Parent is assigned if there's a logical grouping
- [ ] Agent hints match the task content (see agent hints table)
- [ ] Technical context references discovered during Phase 4 research

## Example of a Well-Defined Task

> **Title**: Implementar WebSocket connection manager en frontend

Description:

## Contexto

La feature de notificaciones en tiempo real requiere una conexion WebSocket
persistente entre el frontend y el backend. Actualmente no existe infraestructura
de WebSocket en el proyecto, por lo que hay que crearla desde cero siguiendo los
patrones DDD del proyecto.

## Que hay que hacer

- Crear un custom hook `useWebSocket` en el domain `shared` para manejar la conexion
- Implementar reconexion automatica con backoff exponencial
- Exponer un hook `useNotificationStream` en el domain `notifications` que consuma el WebSocket
- Integrar con React Query para invalidar caches cuando lleguen notificaciones relevantes

## Archivos afectados

- `frontend/src/domains/shared/application/hooks/use-websocket.ts` -- nuevo, hook generico de WebSocket
- `frontend/src/domains/notifications/application/hooks/use-notification-stream.ts` -- nuevo, consume WebSocket
- `frontend/src/domains/notifications/domain/types.ts` -- nuevo, tipos de notificacion
- `frontend/src/lib/api/client.ts` -- modificar para extraer token de auth para WebSocket

## Patron de referencia

See `frontend/src/domains/work-items/application/hooks/use-create-work-item-form.ts` for the
custom hook pattern with React Query integration.

## Consideraciones tecnicas

- El token de auth debe enviarse como query param en la URL del WebSocket (no hay headers en WS)
- Backoff exponencial: 1s, 2s, 4s, 8s, max 30s
- Debe limpiar la conexion en el cleanup del useEffect

Agent hints: frontend-developer
Estimated points: 5

Definition of Done:

- [ ] Hook useWebSocket se conecta al backend WebSocket endpoint
- [ ] Reconexion automatica funciona tras desconexion del servidor
- [ ] Hook useNotificationStream recibe y parsea mensajes de notificacion
- [ ] React Query caches se invalidan cuando llega una notificacion relevante
- [ ] La conexion se cierra limpiamente al desmontar el componente
- [ ] TypeScript compila sin errores
- [ ] ESLint pasa sin warnings

## Example of a BAD Task (avoid this)

> **Title**: Hacer notificaciones
> **Description**: Implementar notificaciones en la app.
> **Definition of Done**: Que funcionen las notificaciones.

This is bad because: vague title, no context, no affected files, no reference pattern, no technical considerations, unmeasurable DoD.

## Anti-patterns to Avoid

- **Don't create tasks for research/analysis** -- that's what Phases 1-4 are for.
- **Don't create mega-tasks** -- break into independently deliverable pieces (max 13 points).
- **Don't create tasks without DoD** -- every task needs verifiable acceptance criteria.
- **Don't duplicate existing tasks** -- always search in Phase 2 with `list_work_items`.
- **Don't create empty parent items** -- only create epics/features/stories if they group 2+ children.
- **Don't skip agent hints** -- always recommend which agents should implement each task.
- **Don't skip technical research** -- Phase 4 is what makes `/ideate` tasks superior to generic ones.
- **Don't propose without user approval** -- always get explicit "approve" before creating in Phase 6.
- **Don't create tasks with generic descriptions** -- every task must reference specific files and patterns from the research.
