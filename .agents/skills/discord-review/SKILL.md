---
name: discord-review
description: Orchestrate a review session from Discord. Use when a user asks to review a work item (e.g. "revisa A-F-56", "review A-425", "/review A-F-XXX"). Extracts work item IDs, narrates every step in a Discord thread, spawns OpenCode ACP, and runs an active progress cron for continuous feedback.
---

# discord-review

This skill runs in the `#dev` channel session. It narrates every orchestration step in a Discord thread and uses an active progress cron for continuous feedback throughout the ACP review session.

## Flow (in #dev)

### 1. Extract IDs

Parse work item IDs from the user message (pattern: `A-\d+` or `A-[EFS]-\d+`). If no valid IDs found, ask the user.

Determine skill:

- Feature/epic IDs (`A-F-*`, `A-E-*`) → `review-feature`
- Task IDs (`A-\d+`) → `review-task`

### 2. Note the requester

Save the Discord user ID from the message metadata (e.g. `USER_ID`).

### 3. React to the original message

React with ✅ to the triggering message:

```
message(action="react", channel="discord", emoji="✅")
```

Do NOT write any text to #dev. This reaction is the only acknowledgement in the channel.

### 4. git pull

```bash
cd "${WORKSPACE_REPO_PATH:-/workspace/repo}" && git pull origin main
```

### 5. Spawn OpenCode ACP in thread

Call `sessions_spawn` with:

- `runtime`: `"acp"`
- `agentId`: `"opencode"`
- `thread`: `true`
- `mode`: `"session"`
- `runTimeoutSeconds`: `3600`
- `label`: `"review-<IDs>"`
- `task`:

```
Follow .agents/skills/review-[feature|task]/SKILL.md. Work item IDs: <IDs>.
Use MCP for board operations. Use scripts/github-app-token.sh for GitHub auth.
Never use gh cli directly.
Report progress in natural language on their own line: normal progress, success, warning, and failure prose
See .agents/skills/discord-agent-relay/SKILL.md for full relay protocol.
```

From the response, save:

- `sessionKey` → `acp_session_key`
- `channelId` (the thread ID) → `thread_channel_id`

### 6. Post opening message IN THE THREAD

Send a multi-line opening message **into the thread** — NOT into #dev:

```
message(
  action="send",
  channel="discord",
  target="<thread_channel_id>",
  message="<@<userId>> 🔍 Review de **<IDs>** en marcha\n\n✅ Pull de main completado\n✅ Sesión OpenCode lanzada\n⏳ El agente va a revisar la implementación..."
)
```

⚠️ Discord mentions require `<@USER_ID>` format. Never use `@USER_ID`.

### 7. Set up active progress cron

Create a cron job that provides continuous feedback (progress checkpoints + stagnation detection + completion cleanup). Runs every 45 seconds.

Substitute real values for `ACTUAL_SESSION_KEY`, `ACTUAL_THREAD_ID`, and `ACTUAL_IDS` before calling cron.

```
cron(action="add", job={
  name: "watchdog-review-ACTUAL_IDS",
  schedule: { kind: "every", everyMs: 45000 },
  sessionTarget: "isolated",
  delivery: { mode: "none" },
  payload: {
    kind: "agentTurn",
    message: "You are a progress relay and watchdog for an ACP review session.\n\nACP session key: ACTUAL_SESSION_KEY\nDiscord thread ID: ACTUAL_THREAD_ID\nWork item IDs: ACTUAL_IDS\n\nSteps:\n1. Call sessions_list and find the session with key ACTUAL_SESSION_KEY.\n\n2. If the session is NOT FOUND (ACP completed or crashed):\n   a. Call sessions_history(sessionKey: 'ACTUAL_SESSION_KEY', limit: 10, includeTools: false).\n   b. Look for success, failure, or warning summaries updates.\n   c. Send final message to thread ACTUAL_THREAD_ID:\n      - If successful: '✅ Review completado. <summary>'\n      - If failed: '🔴 Review fallido: <reason>'\n      - If partial/warning: '⚠️ Review completado con avisos: <reason>'\n      - Default: 'ℹ️ Sesión finalizada.'\n   d. Rename thread to '✅ Review ACTUAL_IDS' (or '❌ Review ACTUAL_IDS') via PATCH /channels/ACTUAL_THREAD_ID.\n   e. Remove this cron: call cron(action=list), find the job with name 'watchdog-review-ACTUAL_IDS', and call cron(action=remove, jobId=<found id>).\n   f. Stop.\n\n3. If session EXISTS, check updatedAt:\n   a. If unchanged >10 min: send '⚠️ Lleva más de 10 min sin avance. ¿Quieres que lo cancele?' to thread. Stop.\n   b. If >45s but <10 min ago: do nothing, stop.\n   c. If <45s ago: continue to step 4.\n\n4. Call sessions_history(sessionKey: 'ACTUAL_SESSION_KEY', limit: 15, includeTools: false).\n\n5. Parse updates and meaningful text:\n   - progress summaries for review phases (fetching context, reviewing files, running checks)\n   - Task pass/fail results\n   - Automated check results (type-check, lint)\n\n6. Build compact progress checkpoint:\n   ⚙️ HH:MM — <current phase>\n   ├── ✅ <completed step>\n   ├── ✅ <completed step>\n   └── 🔄 <current activity>\n   Keep to 5-6 lines max.\n\n7. Send checkpoint as NEW message to thread ACTUAL_THREAD_ID. Only if meaningful new progress.",
    timeoutSeconds: 30
  },
  label: "progress-review-<IDs>"
})
```

## CRITICAL: Stay silent in the channel

After step 3 (reaction), do NOT write anything to #dev. All communication happens in the thread.
The active progress cron handles continuous feedback, stagnation detection, and completion cleanup.

**End your response to the channel with NO_REPLY.**
