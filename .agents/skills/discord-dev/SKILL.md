---
name: discord-dev
description: Usar cuando un usuario pide en el canal #dev de Discord implementar, planificar o revisar work items de Almirant. Abre un thread de Discord y lanza una sesión ACP con OpenCode. SIEMPRE usar sessions_spawn con runtime acp. NUNCA usar exec ni CLI directamente.
---

# Discord Dev — Canal

## ⚠️ Reglas absolutas

- **SIEMPRE** usar `sessions_spawn` con `runtime: "acp"` y `agentId: "opencode"` para cualquier acción.
- **NUNCA** usar exec, claude CLI, opencode CLI, ni ningún otro proceso directo.
- **NUNCA** escribir en el canal principal después de crear el thread.
- **NUNCA** usar `🔄` como emoji — solo los emojis de la tabla de abajo.

## Paso 1: Crear thread

Crea el thread desde el mensaje del usuario con el `message` tool. Usa el `messageId` del mensaje entrante (disponible en el contexto):

```json
{
  "action": "thread-create",
  "channel": "discord",
  "channelId": "<channelId del canal #dev>",
  "messageId": "<messageId del mensaje del usuario>",
  "threadName": "<nombre según tipo>"
}
```

| Tipo | Formato | Ejemplo |
|---|---|---|
| Revisión | `🔎 Review <ID>` | `🔎 Review A-F-59` |
| Implementación | `⚒️ <ID>` | `⚒️ A-F-90` |
| Planificación | `💡 Planning - <tema>` | `💡 Planning - Botón de pago` |

## Paso 2: Comprobar slots ACP

Llama a `sessions_list` y cuenta sesiones cuyo `key` empiece por `agent:claude:acp:`. Máximo 4.

### Si hay slot libre (< 4)

Procede al Paso 3.

### Si no hay slot (4/4)

Escribe en el thread:

```
<@USER_ID> ⏳ Los 4 slots están ocupados. Te aviso en cuanto se libere uno.
```

Crea un cron que monitoree y postee updates en el thread cada 60s:

```json
{
  "name": "monitor-slots-<ID>",
  "schedule": { "kind": "every", "everyMs": 60000 },
  "sessionTarget": "isolated",
  "delivery": { "mode": "none" },
  "payload": {
    "kind": "agentTurn",
    "timeoutSeconds": 60,
    "message": "Cuenta sesiones acp (sessions_list, keys que empiecen por 'agent:claude:acp:'). Si <4: send al thread <THREAD_ID> '✅ Slot libre — arrancando.' luego lanza sessions_spawn(runtime:acp, agentId:opencode, task:<TASK>) y elimina este cron. Si 4/4: send al thread <THREAD_ID> '⏳ Seguimos esperando — X/4 slots. Próxima comprobación en ~1 min.'"
  }
}
```

## Paso 3: Lanzar sesión ACP con OpenCode

Usa `sessions_spawn` — **obligatorio**:

```json
{
  "runtime": "acp",
  "agentId": "opencode",
  "mode": "session",
  "thread": true,
  "task": "<tarea según tipo — ver abajo>"
}
```

Inmediatamente después, escribe en el thread mencionando al usuario:

```
<@USER_ID> 🔎 Arrancando revisión de <ID>...
```

### Tareas por tipo

**Revisión:**

```
git pull origin main && ejecuta la skill review-feature para <ID> (o review-task si es tarea/story). 
Postea el progreso en Discord thread <THREAD_ID> con formato ⚙️ Progreso (HH:MM). 
Mueve a Validating si PASS, a In Progress si FAIL.
```

**Implementación:**

```
git pull origin main && ejecuta la skill implement para <ID>.
Postea el progreso en Discord thread <THREAD_ID> con formato ⚙️ Progreso (HH:MM).
```

**Planificación:**
Primero pregunta en el thread qué quiere planificar. Cuando responda:

```
git pull origin main && ejecuta la skill ideate para: <descripción del usuario>.
Postea el progreso en Discord thread <THREAD_ID> con formato ⚙️ Progreso (HH:MM).
```

## IDs de Discord

| Usuario | ID |
|---|---|
| Example user | `USER_ID` |

## Respuesta en el canal

Después de crear el thread y lanzar la sesión ACP: **NO_REPLY** en el canal principal.
