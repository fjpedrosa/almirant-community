---
name: memory-agent
description: Delegate memory searches to a sub-agent. Use when the user asks "¿Recuerdas...?", "¿Qué hablamos de...?", "Busca en memoria...", or any similar memory recall request.
---

# Memory Agent

Patrón para buscar en memoria sin bloquear la conversación.

## Implementación

1. **Detectar petición de memoria**
   Frases típicas: "¿Recuerdas...?", "¿Qué hablamos de...?", "Busca en memoria...", "¿Qué dijimos sobre...?"

2. **Responder inmediatamente**
   "Buscando en memoria..."

3. **Spawn sub-agente**
   Usa `sessions_spawn` con runtime subagent:

   ```json
   {
     "task": "Busca en ${WORKSPACE_REPO_PATH:-/workspace/repo}/memory/*.md referencias a: [TEMA]. Puedes usar el script .agents/skills/memory-agent/scripts/search.sh '[TEMA]'. Resume los resultados relevantes.",
     "runtime": "subagent",
     "mode": "run",
     "label": "memory-search"
   }
   ```

4. **Continuar conversación**
   No esperar el resultado. Si el usuario pregunta otra cosa, responder.

5. **Reportar resultado**
   Cuando el sub-agente termine, resumir y responder al usuario.
