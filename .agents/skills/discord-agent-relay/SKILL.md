---
name: discord-agent-relay
description: Generic relay guidance between OpenClaw and any code agent (OpenCode, Claude Code, Codex) running in a Discord thread. Uses native session events, tool events, and natural-language summaries instead of textual control tokens.
---

# discord-agent-relay

Defines how OpenClaw should relay an agent session into a Discord thread without requiring the agent to print special control tokens.

---

## 1. Agent output contract

Code agents should write normal, human-readable progress updates. Do not require fixed textual prefixes or bracketed control tokens.

A good agent update is:

- Short enough to relay directly to Discord.
- Explicit about the phase, current work item, and blocker if any.
- Written as prose or a compact bullet list.
- Followed by a clear final summary containing outcome, changed items, failures, and next steps.

For parallel work, describe the wave in prose:

- Which work items started.
- Which specialist owns each item.
- Which items completed or failed.
- The final wave result.

For interactive work, ask the question in plain text, list options as bullets if useful, then stop and wait for the user's reply in the thread. Do not use tool-based user prompts inside Discord-bound ACP sessions unless the host explicitly supports them.

---

## 2. Relay model

There are two sources of truth for progress:

1. **Native ACP/session events**: tool calls, file reads, subagent spawn/complete events, stdout chunks, session status, and final state.
2. **Agent prose**: meaningful text messages written by the agent for the user.

OpenClaw should relay both as normal Discord messages or compact checkpoints. It should not depend on parsing special strings from the transcript.

### Auto-relay

With `thread: true` + ACP, OpenClaw can relay the ACP output stream to the bound thread. This is a convenience path only; correctness must not depend on special text in that stream.

### Active progress cron

A cron job runs every **45 seconds**, reads `sessions_history` to get the real ACP session state, and posts progress to the thread. This ensures feedback even when the passive relay drops output.

#### Cron behavior

Each cron run is an ephemeral agent. It receives the session key, thread ID, and context as parameters.

```
1. sessions_list → find session by key
   ├── NOT FOUND → session ended
   │   ├── Read sessions_history(limit: 5) for outcome and final prose
   │   ├── Post final message based on real job/session state
   │   ├── Rename thread
   │   ├── Self-remove cron
   │   └── Stop
   │
   ├── FOUND but updatedAt > 10 min ago → stagnant
   │   ├── Post warning: "⚠️ Lleva más de 10 min sin avance..."
   │   └── Stop
   │
   ├── FOUND but updatedAt between 45s and 10 min → idle
   │   └── Do nothing, stop
   │
   └── FOUND and updatedAt < 45s ago → active
       ├── Read sessions_history(limit: 15, includeTools: false)
       ├── Extract meaningful prose and native event state
       ├── Build compact status summary
       ├── Post new checkpoint message to thread
       └── Stop
```

#### Checkpoint message format

```
⚙️ HH:MM — <one-line summary of current phase>
├── ✅ <completed step 1>
├── ✅ <completed step 2>
└── 🔄 <current activity>
```

Rules:

- Only post when there is new meaningful progress.
- Keep messages compact, ideally 5-6 lines.
- Use native session/tool/subagent events where possible instead of parsing prose.
- Include timestamp for chronological tracking.

---

## 3. Spawning a code agent

When spawning any Discord-bound code agent, include this instruction in the task:

```
You are running inside a Discord-bound agent session. Report progress in concise natural language. Do not use fixed textual control tokens. For parallel work, summarize the wave launch, each agent result, and the wave outcome in prose. For final output, include a clear outcome summary, completed items, failed items, verification, and next steps.

For interactive skills, ask the question in plain text, list options as bullets if useful, then stop and wait for the user's reply in the thread. Do not call a user-question tool unless the host explicitly supports it for this session.
```

---

## 4. Bidirectional relay

Some skills require user input during execution. The ACP session bound to the thread receives user messages directly through the thread binding.

```
User writes in thread → OpenClaw detects message → Relays to ACP session → Agent continues
```

The progress cron for interactive skills should:

1. Read recent session history.
2. Detect pending questions from normal prose plus session state.
3. If a question appears unresolved, post it prominently in the thread with `<@USER_ID>` mention.
4. Let the user's response flow back through the thread binding.

---

## 5. Message editing in Discord

Use the `message` tool with the saved `messageId` only when a Discord message represents a durable aggregate view, such as a wave summary. Otherwise, post compact checkpoint messages.

---

## 6. Watchdog

The watchdog behavior is built into the progress cron. It handles:

### Completion detection

When `sessions_list` no longer finds the ACP session:

1. Read final transcript via `sessions_history`.
2. Determine outcome from the real job/session state first, then final prose as supporting context.
3. Post final message to thread.
4. Rename thread with a status prefix.
5. Self-remove cron via `cron(action=list)` + `cron(action=remove)`.

### Stagnation detection

When session exists but `updatedAt` is unchanged for more than 10 minutes:

- Post warning to thread.
- Do not auto-cancel; let the user decide.

### Self-cleanup

The cron must remove itself when the session ends. Use a unique `label` such as `progress-implement-A-445` so the cron can find and remove itself via `cron(action=list)`.

Never leave orphaned crons. The cron always self-removes on session completion.

---

## 7. Standard cron template

All Discord skills use this template. Replace `{PLACEHOLDERS}` with actual values.

```
cron(action="add", job={
  schedule: { kind: "every", everyMs: 45000 },
  sessionTarget: "isolated",
  payload: {
    kind: "agentTurn",
    message: "<cron instructions — see each skill for specific content>",
    timeoutSeconds: 30
  },
  label: "progress-{TYPE}-{CONTEXT}"
})
```
