# Event Pipeline Architecture

> Diagrama completo del flujo de eventos desde los Coding Agents hasta los consumidores (Discord + Web).
> Generado el 2026-04-04.

---

## 1. Vista General (High-Level)

```
┌─────────────────────────────────────────────────────────────┐
│                     RUNNER (Hetzner VPS)                     │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌────��─────┐                  │
│  │ Claude   │  │ Codex    │  │ OpenCode │  ← Coding Agents  │
│  │ Code     │  │ (OpenAI) │  │          │    (en containers) │
│  └────┬────���┘  └────┬─────┘  ���────┬─────┘                  │
│       │              │              │                         │
│       ▼              ▼              ▼                         │
│  ┌��─────────┐  ┌──────────┐  ┌���─────────┐                  │
│  │ claude-  │  │ codex-   │  │ opencode-│  ← Shims          │
│  │ shim     │  │ shim     │  │ shim     │    (adaptadores)   │
│  └──��─┬─────┘  └��───┬─────┘  └────��─────┘                  │
│       │              │              │                         │
│       ��              ▼              ▼                         │
│  ┌──────────────────────────────────────┐                   │
│  │         shim-server (Express)        │  ← HTTP/SSE       │
│  │  POST /session/:id/message           │    unificado       │
│  │  GET  /event (SSE broadcast)         │                    │
│  └────��─────────────┬─────��─────────────┘                   │
│                     │ SSE events                             │
│                     ▼                                        │
│  ┌──────────────────────────────────────┐                   │
│  │         job-executor.ts              │                    │
│  │  ┌──────────────────────────┐        │                    │
│  │  │ sse-canonical-adapter    │        │  ← Traduce SSE     │
│  │  │ SSEEvent → CanonicalEvent│        │    a formato        │
│  │  └────────────┬─���───────────┘        │    canónico         │
│  │               │                      │                    │
│  │               ▼                      │                    │
│  │  publishCanonicalEvent()             │                    │
│  │  XADD → Redis Stream                │                    │
│  └──────────────────┬─────���─────────────┘                   │
│                     │                                        │
└─────────────────────┼──────────��─────────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │  Redis Stream   │
            │  (agent:output) │
            └────────┬────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
��─────────────────┐   ┌─────────────────┐
│ discord-bridge  │   │  web-bridge     │
│ (consumer group)│   │ (consumer group)│
└────────┬──���─────┘   └────────┬────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌──��──────────────┐
│  Discord API    │   │  Redis Pub/Sub  │
│  (threads)      │   │  (canal WS)     │
└────────���────────┘   └���───────┬────────┘
                               │
                               ▼
                      ┌──���──────────────┐
                      │ Backend Elysia  │
                      │ WS layer        │
                      │ (ws broadcast)  │
                      └────────┬─��──────┘
                               │
                               ▼
                      ┌──���──────────────┐
                      │ Frontend        │
                      │ WebSocket       │
                      │ (useWebSocket)  │
                      └────────┬─��──────┘
                               ���
                               ▼
                      ┌─────────────────┐
                      │ usePlanning-    │
                      │ Session reducer │
                      │ → UI render     │
                      └─────────────────┘
```

---

## 2. Detalle: Shims por Coding Agent

Cada Coding Agent tiene un formato de eventos nativo distinto.
Los shims normalizan todo a `SSEEvent { type, properties }`.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SHIM LAYER                                   │
│                                                                     │
│  CLAUDE CODE                                                        │
│  ───────────                                                        │
│  Emite SSE nativo con:                                              │
│    message.part.delta    (contentType: text|thinking|tool_use)      │
│    message.part.updated  (contenido completo de un bloque)          │
│    message.completed                                                │
│    session.idle                                                     │
│    session.error                                                    │
│    question.asked                                                   │
│    permission.asked                                                 │
│                                                                     │
│  claude-shim: Reenvía SSE tal cual al shim-server.                  │
│  También emite canonical events directamente vía onCanonicalEvent   │
│  (tool_use blocks → se serializan como SSE con kind: "agent.xxx")   │
│                                                                     │
│  ────────────────────────────────────────────────────────────────── │
│                                                                     │
│  CODEX (OpenAI)                                                     │
│  ──────────────                                                     │
│  SDK emite ThreadEvents:                                            │
│    item.started / item.updated / item.completed                     │
│    con itemType: agent_message | reasoning | command_execution |    │
│                  file_change | mcp_tool_call                        │
│    turn.completed / turn.failed                                     │
│    approval.*                                                       │
│                                                                     │
│  codex-shim (codex-adapter.ts + event-mapper.ts):                   │
│    - Usa snapshot diffing (messageSnapshots Map)                    │
│    - item.updated → calcula delta vs snapshot anterior              │
│    - Traduce a SSEEvent:                                            │
│        agent_message  → message.part.delta (contentType: text)      │
│        reasoning      → message.part.delta (contentType: thinking)  │
│        command_exec   → message.part.delta (contentType: text)      │
│        file_change    → message.part.updated (text)                 │
│        mcp_tool_call  → message.part.updated (text)                 │
│        turn.completed → session.idle (terminal: true)               │
│        turn.failed    → session.status(error) + session.idle        │
│                                                                     │
│  ⚠️  NO emite tool_use contentType → no hay tool_call.start/result │
│  ⚠️  NO emite onCanonicalEvent → todo pasa por SSE legacy path     │
│                                                                     │
│  ──────��─────────────────────────────────────────────────────────── │
��                                                                     │
│  OPENCODE                                                           │
│  ────────                                                           │
│  Emite canonical events directamente vía onCanonicalEvent callback. │
│  El shim-server los envuelve como:                                  │
│    { type: "<kind>", properties: { kind: "<kind>", ... } }          │
│  El sse-canonical-adapter detecta el prefijo canónico y hace        │
│  passthrough (no re-traduce).                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detalle: sse-canonical-adapter

Traduce SSEEvent → CanonicalEvent[]. Es el punto de normalización central.

```
                    SSEEvent { type, properties }
                              │
                              ▼
                 ┌────────────────────────┐
                 │  sse-canonical-adapter │
                 │                        │
                 │  Estado interno:       │
                 │  - currentContentType  │
                 │  - toolUseBuffer       │
                 │  - activeSubagentIds   │
                 │  - emittedToolIds      │
                 └────────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼

    Canonical Passthrough   SSE Mapping    Tool Buffer
    (opencode events)       (claude/codex) (tool_use JSON)
              │               │               │
              │               │               │
              ▼               ▼               ▼

    Canonical Events (discriminated union por "kind"):

    AGENT OUTPUT              TOOL CALLS              FILE OPS
    ─────────────             ──────────              ────────
    agent.text                agent.tool_call.start   agent.file.read
    agent.thinking            agent.tool_call.result  agent.file.write
    agent.text.complete                               agent.file.edit

    SHELL                     SUBAGENTS               WAVES
    ─────                     ─────────               ─────
    agent.bash.execute        agent.subagent.spawn    agent.wave.start
    agent.bash.output         agent.subagent.complete agent.wave.agent_done
                                                      agent.wave.end

    INTERACTION               SESSION                 JOB
    ───────────               ───────                 ───
    agent.question            session.connected       job.completed
    agent.permission.request  session.idle            job.failed
    agent.step                session.error           job.cancelled
                              session.closed          job.timeout

    SYSTEM                    MESSAGE QUEUE
    ──────                    ─────────────
    heartbeat                 message.queued
    system.info               message.dequeued
    system.warn
```

---

## 4. Detalle: Redis Stream → Consumers

```
┌──────────────────────────────────────────────────────────────┐
│                      Redis Stream                             │
│                   (key: agent:output)                          │
│                                                               │
│  Cada entry contiene:                                         │
│  {                                                            │
│    jobId, sessionId, organizationId, threadId,                │
│    timestamp, sequenceNumber,                                 │
│    type: "message",           ← siempre "message"             │
│    _format: "canonical",      ← marca de formato              │
│    event: "{JSON del CanonicalEvent}"  ← payload serializado  │
│  }                                                            │
└───────────────────────────┬────���─────────────────────────────┘
                            │
              XREADGROUP (consumer groups independientes)
                            │
         ┌──────────────────┴──────────────────┐
         │                                     │
         ▼                                     ▼
┌────────────────────┐              ┌─��──────────────────┐
│  discord-bridge    │              │   web-bridge       │
│  Consumer Group:   │              │   Consumer Group:  │
│  "discord-bridge"  │              │   "web-bridge"     │
│                    │              │                    │
│  SOLO canonical    │              │  canonical +       │
│  (legacy = warn+   │              │  legacy (coalescer │
│   skip)            │              │  path para old     ���
│                    │              │  format)           │
└────────┬───────────┘              └────────┬───────────┘
         │                                   │
         ▼                                   ▼
┌────────────────────┐              ┌────────────────────┐
│ createCanonical-   │              │ createCanonical-   │
│ Router(renderer)   │              │ Router(webRenderer)│
│                    │              │                    │
│ Switch exhaustivo  │              │ Switch exhaustivo  │
│ por event.kind →   │              │ por event.kind →   │
│ renderer.renderX() │              │ renderer.renderX() ���
└────────┬─────���─────┘              └────────┬─────���─────┘
         │                                   │
         ▼                                   ▼
┌─���──────────────────┐              ┌────────────────────┐
│ DiscordRenderer    │              │ WebRenderer        │
│                    │              │                    │
│ renderText →       │              │ renderText →       │
│   Discord message  │              │   planning:text    │
│ renderThinking →   │              │ renderThinking →   │
│   Discord embed    │              │   planning:thinking│
│ renderToolCall →   │              │ renderToolCall →   │
│   activity burst   │              │   planning:tool-   │
│ renderSubagent →   │              │   call-start       │
│   nested thread    │              │ renderSubagent →   │
│ renderJobCompleted │              │   planning:subagent│
│   → status edit    │              │   -spawn           │
│                    │              │ renderJobCompleted │
│ + Button mgmt     │              │   → planning:done  │
│ + Thread rename    │              │                    │
└──────���─┬───────────┘              └────────┬───────────┘
         │                                   │
         ▼                                   ▼
┌────────────────────┐              ┌────────────────────┐
│ Discord API        │              │ Redis.publish()    │
│ (REST + Gateway)   │              │ canal: "ws:events" │
└────────────────────┘              └────────┬───��───────┘
                                             │
                                             ▼
```

---

## 5. Detalle: Web Pipeline (Redis Pub/Sub → Frontend)

```
┌────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Redis Pub/Sub                                                  │
│  Canal: "ws:events"                                             │
│                                                                 │
│  Payload publicado:                                             │
│  {                                                              │
│    organizationId: "org-123",                                   │
│    message: {                                                   │
│      type: "planning:text",          ← tipo WS                  │
│      payload: {                                                 │
│        sessionId: "sess-456",                                   │
│        content: "Hello world"                                   │
│      }                                                          │
│    }                                                            │
│  }                                                              │
└───────────────────────────┬────────────���───────────────────────┘
                            │
                            │  Redis SUBSCRIBE
                            ���
┌────────────────────────────────────────────────────────────────┐
│  Backend Elysia (port 3001)                                     │
│  WebSocket handler (/ws)                                        │
│                                                                 │
│  1. Frontend conecta via WebSocket con token de sesión          │
│  2. Backend valida token → extrae organizationId del usuario    │
│  3. Suscribe Redis canal "ws:events"                            │
��  4. Filtra mensajes por organizationId del usuario              │
│  5. Reenvía message al WebSocket del cliente                    │
│                                                                 │
│  También maneja:                                                │
│  - ping/pong heartbeat                                          │
│  - Broadcast de eventos internos (work-item:created, etc.)      │
│                                                                 │
└───────────────────────────┬──��──────────────────────────���──────┘
                            │
                            │  WebSocket frame
                            ▼
┌─────────────────────────────────���──────────────────────────────┐
│  Frontend (Next.js, port 3000)                                  │
│                                                                 │
│  WebSocketProvider (layout.tsx)                                  │
│  └── useWebSocket()                                             │
│      ├── Conecta a ws://backend/ws?token=xxx                    │
│      ├── Heartbeat cada 30s (ping/pong)                         │
│      ├── Reconnect exponencial (max 10 intentos)                │
│      └── subscribe(type, handler) → notifica a subscribers      │
│                                                                 │
│  Subscribers globales (websocket-provider.tsx):                  │
│  ├── work-item:created/updated/deleted → invalidate queries     │
│  ├── agent-job:status-changed → invalidate board                │
│  ├── worker-interaction:created → toast + invalidate            │
│  ├── notification:new → toast                                   │
│  └── planning-session:* → invalidate sessions                   │
│                                                                 │
│  Subscribers de planning (use-planning-session.ts):             │
│  ├── planning:text        → append to streamingContent          │
│  ├── planning:thinking    → append to thinkingContent           │
│  ���── planning:tool-call-start → add StreamingBlock              │
│  ├── planning:tool-call-result → update StreamingBlock          │
│  ├── planning:file-read/change → add StreamingBlock             │
│  ├── planning:bash-execute → add StreamingBlock                 │
│  ├── planning:subagent-spawn → add StreamingBlock               │
│  ├── planning:subagent-complete → update StreamingBlock         │
│  ├── planning:wave-start/end → update waveInfo                  │
│  ├── planning:question    → set pendingQuestion                 │
│  ├── planning:step        → update currentStep                  │
│  ├── planning:done        → graduate content → message          │
│  ├── planning:error       → show error                          │
│  └── planning:response-complete → graduate streaming → idle     │
│                                                                 │
└──────────────���──────────────────────────��──────────────────────┘
```

---

## 6. Detalle: Codex Event Translation Path

⚠️ Este es el path con más transformaciones (6 capas):

```
Codex SDK (ThreadEvent)
  │
  │  item.updated { item: { type: "agent_message", text: "Hello wor" } }
  │  item.updated { item: { type: "agent_message", text: "Hello world!" } }
  │  item.completed { item: { type: "agent_message", text: "Hello world!" } }
  │
  ▼
codex-shim/event-mapper.ts (mapCodexEventToSse)
  │
  │  Snapshot diffing:
  │    snapshot["msg-1"] = "" → "Hello wor" → delta = "Hello wor"
  │    snapshot["msg-1"] = "Hello wor" → "Hello world!" → delta = "ld!"
  │
  │  Emite SSEEvents:
  │    { type: "message.part.delta", properties: { delta: "Hello wor", contentType: "text" } }
  │    { type: "message.part.delta", properties: { delta: "ld!", contentType: "text" } }
  │    { type: "message.part.updated", properties: { contentType: "text", part: { text: "..." } } }
  │    { type: "session.idle", properties: { sessionId } }  ← terminal
  │
  ▼
shim-server/server.ts (broadcast)
  │
  │  Envía vía SSE a todos los clientes conectados a /event
  │  event: message
  │  data: {"type":"message.part.delta","properties":{...}}
  │
  ▼
job-executor.ts (SSE listener)
  │
  │  Lee el stream SSE del container
  │
  ▼
sse-canonical-adapter.ts (processEvent)
  │
  │  message.part.delta + contentType:"text" → { kind: "agent.text", content: "Hello wor" }
  │  message.part.delta + contentType:"text" → { kind: "agent.text", content: "ld!" }
  │  session.idle → { kind: "session.idle", ... }
  │
  │  ⚠️ NOTA: Codex NO emite contentType:"tool_use"
  │  → Las operaciones de Codex (command_execution, file_change)
  │    se traducen como texto plano, NO como tool_call.start
  │  → El frontend NO muestra bloques de herramientas para Codex
  │
  ▼
publishCanonicalEvent (Redis XADD)
  │
  │  { _format: "canonical", event: '{"kind":"agent.text","content":"Hello wor"}' }
  │
  ▼
Redis Stream → web-bridge consumer → WebRenderer → Redis Pub/Sub
  │
  │  { type: "planning:text", payload: { sessionId, content: "Hello wor" } }
  │
  ▼
Backend WS → Frontend WebSocket → usePlanningSession reducer → UI
```

---

## 7. Comparison: Discord vs Web paths

```
                    Redis Stream
                         │
          ┌──────────────┴──────────────┐
          │                             │
    discord-bridge                web-bridge
          │                             │
    CanonicalRouter               CanonicalRouter
          │                             │
    DiscordRenderer               WebRenderer
          │                             │
          │                         Redis Pub/Sub
          │                             │
          │                      Backend WS relay
          │                             │
          │                      Frontend WebSocket
          │                             │
    Discord API                  usePlanningSession
          │                             │
          ▼                             ▼
    1 hop después               4 hops después
    del Router                  del Router
          │                             │
    Renderizado DIRECTO          Cada hop es un
    a Discord                    punto de fallo
                                 silencioso

    PUNTOS DE FALLO WEB-ONLY:
    ─────────────────────────
    ① WebRenderer mapea mal el kind → no publica
    ② Redis Pub/Sub pierde el mensaje (no hay ACK)
    ③ Backend WS filtra por organizationId incorrecto
    ④ Frontend WS no está suscrito al type correcto
    ⑤ Reducer no maneja el type → lo ignora
    ⑥ sessionId no coincide con la sesión activa → filtrado
```

---

## 8. Paquetes compartidos

```
@almirant/stream-consumer (backend/packages/stream-consumer/)
├── canonical-events.ts      → CanonicalEvent union type (30+ event kinds)
├── bridge-renderer.ts       → BridgeRenderer interface + createCanonicalRouter()
├── stream-reader.ts         → XREADGROUP consumer con retry
├── stream-publisher.ts      → XADD publisher
├── coalescer.ts             → Batching de eventos legacy (idle/maxWait timers)
├── canonical-serializer.ts  → Serialize/deserialize envelopes
└── types.ts                 → AgentOutputEvent (legacy flat format)

@almirant/shim-server (services/runner/docker/shim-server/)
├── server.ts                → Express SSE server (unified para todos los shims)
├── adapter.ts               → RuntimeAdapter interface
├── session-queue.ts         → Cola de prompts por sesión
├── types.ts                 → SSEEvent, PromptRequest, SessionCreateInput
└── canonical-types.ts       → CanonicalEvent subset para shims

Cada shim implementa RuntimeAdapter:
├── claude-shim/   → ClaudeAdapter (usa claude CLI + SSE parsing)
├── codex-shim/    �� CodexAdapter (usa @openai/codex SDK + snapshot diffing)
└── opencode-shim/ → OpenCodeAdapter (emite canonical events directamente)
```

---

## 9. WS Message Types (Web Pipeline)

Tipos que el WebRenderer publica y el frontend consume:

| Canonical Event Kind       | WS Message Type              | Frontend Handler                |
|----------------------------|------------------------------|---------------------------------|
| `agent.text`               | `planning:text`              | Append to streamingContent      |
| `agent.thinking`           | `planning:thinking`          | Append to thinkingContent       |
| `agent.tool_call.start`    | `planning:tool-call-start`   | Add StreamingBlock              |
| `agent.tool_call.result`   | `planning:tool-call-result`  | Update StreamingBlock           |
| `agent.file.read`          | `planning:file-read`         | Add StreamingBlock              |
| `agent.file.write/edit`    | `planning:file-change`       | Add StreamingBlock              |
| `agent.bash.execute`       | `planning:bash-execute`      | Add StreamingBlock              |
| `agent.subagent.spawn`     | `planning:subagent-spawn`    | Add StreamingBlock              |
| `agent.subagent.complete`  | `planning:subagent-complete` | Update StreamingBlock           |
| `agent.wave.start`         | `planning:wave-start`        | Set waveInfo                    |
| `agent.wave.agent_done`    | `planning:agent-done`        | Update waveInfo agent           |
| `agent.wave.end`           | `planning:wave-end`          | Complete waveInfo               |
| `agent.question`           | `planning:question`          | Set pendingQuestion             |
| `agent.permission.request` | `planning:question`          | Set pendingQuestion (as option) |
| `agent.step`               | `planning:step`              | Update currentStep              |
| `session.idle`             | `planning:response-complete` | Graduate content → message      |
| `session.error`            | `planning:error`             | Show error                      |
| `job.completed`            | `planning:done`              | Session complete                |
| `job.failed`               | `planning:error`             | Session error                   |
| `message.queued`           | `planning:message-queued`    | Show queue position             |
| `message.dequeued`         | `planning:message-dequeued`  | Clear queue indicator           |
| `session.connected`        | *(silenced)*                 | —                               |
| `heartbeat`                | *(not broadcast)*            | —                               |
