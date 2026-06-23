---
name: review
description: "Orchestrate reviews for one or more features/epics/tasks in Review column. Creates a Discord thread per item, runs reviews concurrently (up to 3 in parallel), posts live progress pings, renames threads to ✅/❌ based on result, and schedules auto-close at 12h."
argument-hint: "[feature-id-1] [feature-id-2] ... | --all"
---

# Review Skill

Orchestrate reviews for work items in the Review column. Handles Discord threads, live pings, concurrency (max 3), and final status reporting.

## Input parsing

- `$ARGUMENTS` is a space-separated list of work item IDs (e.g. `A-F-98 A-F-99`) **OR** the flag `--all`.
- If `--all`: query the board for all items currently in the **Review column** using `almirant_list_work_items` with the Review column ID, then treat all returned IDs as the input list.
- If no arguments and no `--all`: check the current board for items in Review, present the list to the user and ask which to review.

## Configuration

- **Discord channel**: configure via runtime `DISCORD_CHANNEL_ID` and `DISCORD_GUILD_ID`
- **Concurrency**: max **3** reviews running in parallel at any time
- **Review column ID**: resolve dynamically via `almirant_list_boards` → find column where `name` matches "Review" or "Reviewing"
- **Ping interval**: post a status update to the thread every ~45 seconds while OpenCode is running

## Per-item flow

For each work item to review:

### 1. Create Discord thread

```
Thread name: 🔄 review <ID>
First message: @everyone Revisando **<ID>** — <title> 🔍
```

Use `message` tool with `action=thread-create`, `channelId=DISCORD_CHANNEL_ID`, `guildId=DISCORD_GUILD_ID`.

### 2. Post initial context message

In the thread, post:

```
📋 **Contexto**
- Tipo: feature / task / epic
- Hijos en Review: N tasks
- Agente: OpenCode (glm-5)
⏳ Iniciando análisis...
```

### 3. Launch OpenCode review

Use `exec` with `background: true` and appropriate `yieldMs` (5000):

```bash
cd "${WORKSPACE_REPO_PATH:-/workspace/repo}" && opencode run "Validate work item <ID> (uuid: <uuid>) following .agents/skills/validate/SKILL.md" 2>&1
```

Note the session name returned by exec.

### 4. Active ping loop

While the process is running, poll every 45 seconds and post to the thread:

```
⚙️ **Agente activo** — [timestamp]
Revisando tasks... (proceso: <session-name>)
```

Parse the process log for meaningful lines to include (tool calls like `almirant_complete_review`, file reads, assertion results) and include them as brief context:

```
⚙️ **Progreso** [HH:MM]
- ✓ Revisó `work-item-card.tsx`
- ✓ Ejecutó type-check
- 🔍 Analizando `sprint-repository.ts`...
```

### 5. Detect completion

When the process exits (code 0 or non-zero), read the final log output to determine result:

- Look for `almirant_complete_review` calls with `result: "pass"` or `result: "fail"`
- Count passed vs failed tasks

### 6. Post final result to thread

**If all tasks PASSED:**

```
## ✅ Review completado — <ID>

**N/N tasks PASSED**

- ✅ <task-id> — <title>
- ✅ <task-id> — <title>

Todos los tasks → Testing ✅
```

**If any task FAILED:**

```
## ❌ Review completado — <ID>

**X passed / Y failed**

- ✅ <task-id> — <title>
- ❌ <task-id> — <title>
  Issues:
  - [issue 1]
  - [issue 2]

Tasks fallidos → In Progress 🔁
```

### 7. Rename thread

- All passed → rename to `✅ review <ID>`
- Any failed → rename to `❌ review <ID>`

Use `message` tool with `action=channel-edit`, `channelId=<thread-id>`, `name=<new-name>`.

### 8. Schedule thread close

Create a cron job via `cron` tool to close the thread in 12 hours:

```json
{
  "name": "close-thread-review-<ID>",
  "schedule": { "kind": "at", "at": "<ISO timestamp 12h from now>" },
  "payload": {
    "kind": "systemEvent",
    "text": "Cierra el hilo de Discord <thread-id> (review <ID>) usando message tool action=channel-edit con archived=true."
  },
  "sessionTarget": "main"
}
```

## Concurrency management

Process items in **batches of 3**:

1. Take the first 3 items from the queue.
2. Launch all 3 simultaneously (exec background=true).
3. While they run, post pings to all 3 threads every 45 seconds.
4. Wait for all 3 to complete before launching the next batch.
5. Repeat until queue is empty.

If `--all` returns more than 9 items, process in batches and note in the main channel:

```
📦 **Review batch nocturno** — X items en Review
Procesando en grupos de 3. Estimado: ~Y minutos.
```

## Announce summary in main channel

After ALL reviews complete, post a summary to the configured Discord review channel:

```
## 🌙 Review nocturno completado

**X/Y features pasaron** | N tasks al total

| Feature | Result | Tasks |
|---------|--------|-------|
| A-F-99  | ✅     | 3/3   |
| A-F-98  | ❌     | 4/5   |

Ver hilos individuales para detalles.
```

(Use Discord markdown, no ASCII tables — use plain list if tables look bad)

## Error handling

- If OpenCode process exits with non-zero code AND no `almirant_complete_review` calls found: post `⚠️ Agente terminó sin resultado — revisar manualmente` and rename thread to `❌ review <ID>`.
- If Discord thread creation fails: log to main channel and continue with next item.
- If `--all` returns 0 items: post `✅ No hay items en Review — todo limpio!` to main channel.

## Pre-flight checks

Before starting any review:

1. **Verify the coding agent is authenticated**: confirm your configured provider/agent is ready (e.g. `opencode auth list`).
2. If the check fails: post `⚠️ Coding agent no disponible — reviews pausados` to main channel and stop.
