---
name: create-tasks
description: Brainstorm and create well-structured work items (epics, features, stories, tasks) in Almirant following best practices for task definition.
argument-hint: <topic or area to brainstorm>
---

# Create Tasks Skill

You are helping the user brainstorm and create work items in Almirant. The user provides a **topic, area, or idea** (`$ARGUMENTS`) and your job is to guide a structured process to produce high-quality, actionable tasks.

## Key Principles

1. **Tasks are what matters** -- epics, features, and stories are organizational labels. Tasks contain the actual work to be done.
2. **Every task must be actionable** -- a developer (human or AI) should be able to read a task and know exactly what to do.
3. **Quality over quantity** -- fewer well-defined tasks are better than many vague ones.

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

### Phase 1: Understand the request

1. Read the user's input (`$ARGUMENTS`).
2. If the input is vague or broad, ask clarifying questions:
   - What problem are we solving?
   - Who benefits from this?
   - What's the expected scope (small fix, medium feature, large initiative)?
   - Are there existing work items related to this?
3. If the input is clear enough, proceed directly to Phase 2.

### Phase 1.5: Research with specialized agents

Before brainstorming, use specialized agents to understand the existing codebase and identify technical constraints.

#### Agent selection for research

| Research need | Agent (`subagent_type`) | Model param | When to use |
|---|---|---|---|
| Understand existing code structure | `technical-researcher` | _(inherit)_ | **Always** -- understand what exists before proposing changes |
| Frontend architecture analysis | `frontend-clean-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When topic involves frontend |
| Backend architecture analysis | `backend-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When topic involves backend/API |
| Database schema analysis | `database-architect` | _(inherit selected session model -- do NOT pass `model`)_ | When topic involves data model changes |
| Task decomposition strategy | `task-decomposition-expert` | _(inherit selected session model -- do NOT pass `model`)_ | When topic is complex and needs careful breakdown |

#### How to launch research agents

Launch the `technical-researcher` agent (always) plus any domain-specific agents in **parallel** to gather information:

```
Task tool #1:
  subagent_type: "technical-researcher"
  description: "Research existing code for [topic]"
  prompt: "Explore the codebase to understand what exists related to [topic]. List relevant files, patterns used, and identify gaps or areas that need changes. Focus on: [specific areas from user input]"

Task tool #2 (if frontend-related):
  subagent_type: "frontend-clean-architect"
  # Inherit the current session model selected by the user; do NOT pass `model`
  description: "Analyze frontend architecture for [topic]"
  prompt: "Analyze the frontend architecture related to [topic]. Identify which domains are affected, what components/hooks exist, and what new ones would be needed. Check DDD compliance."
```

Collect findings from all agents and use them to inform the task structure in Phase 2.

### Phase 2: Brainstorm and structure

1. **Search for existing related work items** using `get_ideation_context` to avoid duplicates and find potential parents.
2. **Use research findings** from Phase 1.5 to inform the task breakdown. Reference specific files and patterns found.
3. **Propose a structure** to the user. Present it in this format:

```
Proposed structure for: [Topic]

[If needed] Epic: [Title]
  [If needed] Feature: [Title]
    Task: [Title] -- [1-line summary]
    Task: [Title] -- [1-line summary]
  [If needed] Feature: [Title]
    Task: [Title] -- [1-line summary]
[Standalone tasks if no parent needed]
  Task: [Title] -- [1-line summary]
```

1. **Ask the user for approval** before creating anything. Present options:
   - Approve as-is
   - Modify (add/remove/change items)
   - Change priorities
   - Change parent assignments

### Phase 3: Define each task in detail

For each task approved by the user, prepare:

- **Title**: Clear, imperative verb form (e.g., "Implementar validacion de email en formulario de leads")
- **Description**: Context + objective in Markdown. Must answer:
  - What is the current situation / problem?
  - What needs to be done?
  - What files or areas of code are affected? (if known)
  - Any technical constraints or considerations?
- **Definition of Done** (stored in `metadata.definitionOfDone`): A checklist of specific, verifiable criteria. Each item must be testable. Format as Markdown list:

  ```
  - [ ] Criterion 1 that can be verified
  - [ ] Criterion 2 that can be verified
  - [ ] TypeScript compiles without errors
  - [ ] ESLint passes without warnings
  ```

- **Priority**: `low`, `medium`, `high`, or `urgent`
- **Type**: Always `task` for actual work items
- **Parent**: Link to feature/story if applicable
- **Agent hints** (stored in `metadata.agentHints`): Recommend which agents should implement this task:

  | Task content | Recommended agent hint |
  |---|---|
  | Frontend components, hooks, UI | `"frontend-developer"` |
  | Backend routes, services | `"backend-architect"` |
  | Database schema, repositories | `"database-architect"` |
  | Pure TypeScript logic | `"javascript-pro"` |
  | UI/UX design decisions | `"ui-ux-designer"` |
  | Full-stack (frontend + backend) | `"frontend-developer, backend-architect"` |

For epics, features, and stories (if created):

- **Title**: Descriptive noun phrase (e.g., "Sistema de notificaciones en tiempo real")
- **Description**: High-level overview of the scope and goals
- **Priority**: Based on business impact
- **No Definition of Done needed** (their children tasks have the DoD)

### Phase 4: Create work items

1. **Create parents first** (epics, then features, then stories) on the **Product Roadmap** board so you have their IDs for linking.
2. **Create tasks** on the **Desarrollo** board, linking to parents via `parentId`.
3. Use the `create_work_item` MCP tool for each item.
4. After creating all items, present a summary table:

```
Created items:

| ID | Type | Title | Parent | Priority | Board | Agent Hint |
|----|------|-------|--------|----------|-------|------------|
| MC-XXX | epic | ... | -- | high | Roadmap | -- |
| MC-XXX | feature | ... | MC-XXX | high | Roadmap | -- |
| MC-XXX | task | ... | MC-XXX | medium | Desarrollo | frontend-developer |
| MC-XXX | task | ... | MC-XXX | medium | Desarrollo | backend-architect |
```

#### Save planning memory

After all work items are created, persist the planning context for future reference. This is best-effort -- if a call fails, log a warning and continue.

**For each work item created**, call `workitem_save`:

```
workitem_save(
  topicKey: "<taskId-slug>-planning",            // e.g. "mc-t-42-planning"
  title: "Planned: <work item title>",
  workItemId: "<UUID>",                          // the created work item UUID
  taskId: "<TASK-ID>",                           // e.g. "MC-T-42"
  workItemType: "<epic|feature|story|task>",
  action: "created",
  description: "<what this item will deliver, acceptance criteria summary -- 2-3 sentences>",
  rationale: "<why this task structure was chosen>",
  decisions: ["<key technical decisions from research agents>"],
  affectedFiles: ["<files identified during research that will be affected>"],
  projectId: "<project UUID from context>"
)
```

Derive the values from the Phase 1.5 research findings and the Phase 3 task definitions. The `topicKey` should be the lowercased task ID with dots/spaces replaced by hyphens, suffixed with `-planning`.

## Task Quality Checklist

Before creating any task, verify:

- [ ] Title uses imperative form and is specific (not "Mejorar X" but "Implementar validacion de campos en formulario X")
- [ ] Description explains WHY, not just WHAT
- [ ] Description mentions affected files/areas when possible
- [ ] Definition of Done has 3-8 specific, verifiable criteria
- [ ] Definition of Done includes "TypeScript compila sin errores" and "ESLint pasa sin warnings" for code tasks
- [ ] Priority reflects actual urgency/impact
- [ ] Parent is assigned if there's a logical grouping
- [ ] Agent hints are included for implementation guidance

## Example of a Well-Defined Task

```
Title: Implementar drag & drop para reordenar columnas del board

Description:
Actualmente las columnas del board Kanban tienen un orden fijo definido en la base de datos.
Se necesita permitir al usuario reordenar las columnas arrastandolas horizontalmente.

Archivos afectados:
- `frontend/src/domains/work-items/presentation/components/work-item-column.tsx`
- `frontend/src/domains/work-items/presentation/containers/work-item-board-container.tsx`
- `backend/api/src/routes/boards.routes.ts` (nuevo endpoint PATCH para orden)
- `backend/packages/database/src/repositories/board-repository.ts`

Consideraciones:
- Usar @dnd-kit que ya esta en el proyecto para los work items
- El orden debe persistirse en backend (campo `order` de boardColumns)
- No afectar al drag & drop existente de work items entre columnas

Agent hints: frontend-developer, backend-architect

Definition of Done:
- [ ] El usuario puede arrastrar columnas horizontalmente para reordenarlas
- [ ] El nuevo orden se persiste en backend via PATCH /api/boards/:id/columns/reorder
- [ ] Al recargar la pagina, el orden personalizado se mantiene
- [ ] El drag & drop de work items entre columnas sigue funcionando correctamente
- [ ] TypeScript compila sin errores
- [ ] ESLint pasa sin warnings
```

## Example of a BAD Task (avoid this)

```
Title: Mejorar el board
Description: Hacer que el board sea mejor y mas usable.
Definition of Done: Que funcione bien.
```

This is bad because: vague title, no specific actions, no measurable criteria.

## Anti-patterns to Avoid

- **Don't create tasks for research/analysis** -- that's what the brainstorming phase is for.
- **Don't create one mega-task** -- break it into smaller, independently deliverable pieces.
- **Don't create tasks without DoD** -- every task needs verifiable acceptance criteria.
- **Don't duplicate existing tasks** -- always search first with `list_work_items`.
- **Don't create empty parent items** -- only create epics/features/stories if they group 2+ children.
- **Don't skip agent hints** -- always recommend which agents should implement each task.
