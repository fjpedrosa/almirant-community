---
name: discord-plan
description: Orchestrate a planning session from Discord. Use when a user asks to plan, ideate, or design something in the Almirant project (e.g. "planifica X", "/plan X", "quiero planificar..."). Collects context in #dev, spawns OpenCode ACP in a bidirectional Discord thread with continuous feedback.
---

# discord-plan

This skill runs in the `#dev` channel session. It collects context via conversation, spawns OpenCode ACP into a thread with bidirectional relay (the agent can ask questions and the user responds in the thread).

## Flow (in #dev)

### 1. Ask for topic (skip if already provided)

If no topic in message, ask in `#dev`:
> `¿Qué quieres planificar?`

Wait for the user's response.

### 2. Ask for details (always)

Once you know the topic, ask in `#dev`:
> `Cuéntame todo lo que tengas en mente — problema, ideas, restricciones, referencias... cualquier detalle ayuda.`

Wait for the user's response.

### 3. Note the requester

Save the Discord user ID from the message metadata (e.g. `USER_ID`).

### 4. React to the last message

React with checkmark to the user's last message:

```
message(action="react", channel="discord", emoji="✅")
```

Do NOT write any text to #dev after this point.

### 5. git pull

```bash
cd "${WORKSPACE_REPO_PATH:-/workspace/repo}" && git pull origin main
```

### 6. Spawn OpenCode ACP in thread

Call `sessions_spawn` with:

- `runtime`: `"acp"`
- `agentId`: `"opencode"`
- `thread`: `true`
- `mode`: `"session"`
- `runTimeoutSeconds`: `3600`
- `label`: `"plan-<tema-slug>"`
- `task`:

```
Follow .agents/skills/ideate/SKILL.md. Topic: <tema>. User context: <todo lo que contó el usuario>.

IMPORTANT — BIDIRECTIONAL DISCORD THREAD:
You are running inside a Discord thread. The user reads your output and responds directly in the thread.

- Do NOT use the AskUserQuestion tool. It does not work in this context.
- When you need user input, write the question in plain text.
- When presenting options, list them as bullets.
- After asking a question, STOP and wait. The user's reply will arrive as a new message in your session.
- When you receive the user's response, acknowledge it and continue.

Report progress in concise natural language. Include major phase changes, questions, final outcome, and failures as ordinary prose or bullets. Do not use fixed textual control tokens.
```

From the response, save:

- `sessionKey` → `acp_session_key`
- `channelId` (the thread ID) → `thread_channel_id`

### 7. Post opening message IN THE THREAD

Send the first message **into the thread** — NOT into #dev:

```
message(
  action="send",
  channel="discord",
  target="<thread_channel_id>",
  message="<@<userId>> Planning **<tema>** started\n\nThe agent will analyze the topic and ask questions here in the thread.\n\nRespond directly in this thread when the agent asks you something."
)
```

Do NOT use `@USER_ID` format. Discord mentions require `<@USER_ID>` format.

### 8. Set up active progress cron with lifecycle-aware watchdog

Create a cron job that provides continuous feedback AND detects real session completion. Runs every 45 seconds.

**CRITICAL LIFECYCLE RULE**: The watchdog determines completion based on the **real planning_session and agent_job states** from the backend, NOT on ACP session visibility. An ACP session disappearing from `sessions_list` does NOT mean the planning is done — the backend is the source of truth.

Substitute real values for `ACTUAL_SESSION_KEY`, `ACTUAL_THREAD_ID`, `ACTUAL_TEMA`, `ACTUAL_TEMA_SLUG`, and `ACTUAL_USER_ID` before calling cron.

```
cron(action="add", job={
  name: "watchdog-plan-ACTUAL_TEMA_SLUG",
  schedule: { kind: "every", everyMs: 45000 },
  sessionTarget: "isolated",
  delivery: { mode: "none" },
  payload: {
    kind: "agentTurn",
    message: "You are a progress relay, watchdog, and question relay for an interactive ACP planning session.

ACP session key: ACTUAL_SESSION_KEY
Discord thread ID: ACTUAL_THREAD_ID
Topic: ACTUAL_TEMA
User Discord ID: ACTUAL_USER_ID

Steps:
1. Call sessions_list and find the session with key ACTUAL_SESSION_KEY.

2. If the session is NOT FOUND in sessions_list:
   — This does NOT necessarily mean the planning is done.
   — The ACP process may have exited while the backend planning_session is still being finalized.
   — Call sessions_history(sessionKey: 'ACTUAL_SESSION_KEY', limit: 10, includeTools: false).
   — Determine outcome from the real planning_session/job state first, then use final prose as supporting context.
   — On success: send completion message to thread ACTUAL_THREAD_ID, rename thread to '✅ plan — ACTUAL_TEMA', remove this cron, and stop.
   — On failure: send failure message to thread, rename to '❌ plan — ACTUAL_TEMA', remove this cron, and stop.
   — If no final outcome is found: the ACP disappeared prematurely. Do NOT close the session. Send an informational message: 'ℹ️ Agent process ended without a final status. The planning session remains active — the backend will finalize it based on the real job state.' Then remove this cron and stop.

3. If session EXISTS, check updatedAt:
   a. If unchanged >10 min: send stagnation warning to thread. Stop.
   b. Otherwise: go to step 4.

4. Call sessions_history(sessionKey: 'ACTUAL_SESSION_KEY', limit: 20, includeTools: false).

5. QUESTION RELAY (PRIORITY): Check whether recent prose contains an unresolved question without a subsequent user response.
   If a pending question is found:
   a. Format the question clearly.
   b. Send to thread ACTUAL_THREAD_ID with @mention for ACTUAL_USER_ID.
   c. Stop.

6. PROGRESS CHECKPOINT: If no pending question, build a compact status from native session events plus meaningful prose (5-6 lines max).
   Send checkpoint as NEW message to thread ACTUAL_THREAD_ID. Only if meaningful new progress exists.",
    timeoutSeconds: 30
  },
  label: "progress-plan-<tema-slug>"
})
```

## CRITICAL: Stay silent in the channel

After step 4 (reaction), do NOT write anything to #dev. All communication happens in the thread.

The active progress cron handles:

- Continuous progress feedback
- Relaying agent questions to the user with @mention
- Stagnation detection
- Completion cleanup (based on real updates, NOT ACP disappearance)

The bidirectional flow:

```
Agent asks question → question in normal prose
    → Cron detects it → Posts question in thread with @user
        → User responds in thread
            → Thread binding relays response to ACP session
                → Agent continues
```

**End your response to the channel with NO_REPLY.**
