# Informe: Patrones de Diseno de Chat — Claude.ai vs ChatGPT.com

**Fecha**: 2026-03-25
**Objetivo**: Analizar patrones UI/UX de Claude.ai y ChatGPT.com para mejorar la seccion /plan de Almirant

---

## 1. Estructura General del Layout

### Claude.ai
| Zona | Desktop | Mobile |
|------|---------|--------|
| **Sidebar** | ~240px izquierda, colapsable a iconos (~48px) | Oculta completamente, se abre como overlay |
| **Topbar** | Titulo del chat con dropdown + boton "Compartir" | Icono sidebar + titulo truncado + compartir |
| **Area principal** | Centrada con max-width (~720px) | Full width con padding minimo |
| **Panel derecho** | Aparece al abrir un Artefacto (~50% del ancho) | Reemplaza toda la vista |
| **Input** | Fijo abajo, centrado con max-width del chat | Fijo abajo, full width |

### ChatGPT.com
| Zona | Desktop | Mobile |
|------|---------|--------|
| **Sidebar** | ~260px izquierda, colapsable completamente | Overlay deslizante desde la izquierda |
| **Topbar** | Selector de modelo + grupo chat + chat temporal | Hamburguesa + selector modelo |
| **Area principal** | Centrada con max-width (~680px) | Full width |
| **Panel derecho** | Canvas (similar a artifacts) se abre a la derecha | Reemplaza la vista |
| **Input** | Fijo abajo, pill shape redondeado | Fijo abajo, pill shape |

### Patron comun (APLICABLE A /plan)
> **Layout de 3 columnas adaptativo**: Sidebar (sesiones) | Chat (centro) | Panel contextual (derecho, opcional). El panel derecho se activa bajo demanda (artifacts/canvas). En mobile, todo se convierte en vistas apiladas con navegacion por gestos.

---

## 2. Sidebar de Conversaciones

### Claude.ai
- **Navegacion principal**: Nueva conversacion, Buscar (Cmd+K), Personalizar
- **Secciones**: Chats, Proyectos, Artefactos, Codigo (con iconos)
- **Lista recientes**: Flat list sin agrupacion temporal visible, titulo truncado
- **Interaccion hover**: Boton "..." para mas opciones aparece al hover
- **Estado colapsado**: Solo iconos (~48px), los items de navegacion se muestran como iconos
- **Atajos teclado visibles**: Shift+Cmd+O para nuevo chat, Cmd+K para buscar
- **Perfil usuario**: Avatar + nombre + plan ("Plan Max") en la parte inferior

### ChatGPT.com
- **Navegacion principal**: Nuevo chat (Shift+Cmd+O), Buscar chats (Cmd+K), Imagenes
- **Secciones categorizadas**:
  - Features: Aplicaciones, Investigacion avanzada, Codex
  - GPT: Lista de GPTs personalizados con avatares
  - Proyectos: Lista con iconos de color y opciones
  - Recientes: Conversaciones con pin/opciones
- **Agrupacion temporal**: "Recientes" como seccion colapsable con titulo
- **Conversacion fijada**: Icono de pin visible junto al titulo
- **Boton opciones**: Visible al hover, abre menu contextual
- **Perfil usuario**: Avatar circular + nombre + plan ("Plus") en la parte inferior

### Ideas para /plan
1. **Agrupacion por proyecto/fecha**: Agrupar sesiones de planificacion por proyecto y por periodo temporal (hoy, esta semana, anteriores)
2. **Pin de sesiones**: Permitir fijar sesiones importantes arriba
3. **Busqueda rapida con Cmd+K**: Integrar busqueda global de sesiones
4. **Colapso inteligente**: Sidebar colapsable a iconos cuando se abre el panel de seeds/preview

---

## 3. Empty State / Pantalla de Bienvenida

### Claude.ai
- **Saludo personalizado**: "Buenas tardes, Alex" con icono de Claude (estrella naranja)
- **Input centrado**: Textarea prominente en el centro con placeholder "Como puedo ayudarle hoy?"
- **Hint contextual**: "Escribe / para habilidades" como texto flotante
- **Selector de modelo**: "Sonnet 4.6" con dropdown, junto al boton de attach (+) y voz
- **Categorias sugeridas**: Tabs horizontales (Escribir, Aprender, Codigo, Asuntos personales, Seleccion de Claude) con iconos
- **Boton incognito**: Discreto en la parte inferior

### ChatGPT.com
- **Heading directo**: "En que puedo ayudarte?" sin saludo personalizado
- **Input pill**: Forma redondeada tipo pastilla con "+" (archivos), placeholder, microfono, boton voz
- **Sin categorias visibles**: Solo el input, muy minimalista
- **Selector de modelo**: En la topbar, no junto al input

### Ideas para /plan
1. **Saludo contextual**: "Buenas tardes, Alex. ¿Qué quieres planificar hoy?" con icono de Almirant
2. **Quick actions como categorias**: Tabs tipo Claude para los diferentes modos de planificacion (Brainstorm, Refinar Seeds, Crear Epica, Investigar)
3. **Seeds pendientes como sugerencias**: Mostrar chips de seeds sin procesar como prompts sugeridos
4. **Sesiones recientes como tarjetas**: Grid de ultimas 3-4 sesiones con titulo + resumen + fecha

---

## 4. Area de Input

### Claude.ai
- **Textarea multilinea**: Se expande verticalmente al escribir
- **Boton +**: Adjuntar archivos (izquierda inferior)
- **Selector de modelo**: "Opus 4.6" con dropdown (derecha inferior)
- **Boton voz**: Icono de ondas sonoras (derecha)
- **Hint flotante**: "Escribe / para habilidades" visible cuando esta vacio
- **Placeholder contextual**: Cambia entre "Como puedo ayudarle?" (nueva) y "Responder..." (en chat)
- **Enviar**: No hay boton visible — se envia con Enter

### ChatGPT.com
- **Input pill redondeado**: Bordes redondeados tipo pastilla
- **Boton +**: Adjuntar archivos y mas (izquierda)
- **Placeholder**: "Pregunta lo que quieras"
- **Boton dictado**: Icono microfono (derecha)
- **Boton voz**: Circulo negro con icono de ondas (derecha, destacado)
- **Enviar**: Boton circular negro que aparece al escribir (deshabilitado si vacio)

### Ideas para /plan
1. **Textarea expandible**: Ya lo tienen, mantener
2. **Boton de voz prominente**: Ya implementado con microphone-button — asegurar que sea tan visible como en ChatGPT
3. **Modo slash commands**: Implementar "/" para comandos rapidos (/brainstorm, /refinar, /crear-epica)
4. **Contexto visible**: Mostrar badge con las seeds seleccionadas junto al input (como attachments)
5. **Model selector inline**: Mover el selector de modelo junto al input como hace Claude

---

## 5. Renderizado de Mensajes

### Claude.ai
- **Mensajes de usuario**: Fondo ligeramente diferente (beige/crema), texto negro, alineados a la izquierda en un bloque
- **Mensajes de asistente**: Sin fondo especial, texto negro, full-width dentro del max-width
- **Markdown completo**: Headings (h1-h3), bold, italic, listas, tablas, links
- **Code blocks**: Fondo gris oscuro, syntax highlighting, boton de copiar
- **Inline code**: Fondo rojo/rosa claro con texto rojo (`code`)
- **Acciones en mensajes**: Aparecen al hacer hover/scroll
  - **Usuario**: Fecha (22 mar), Retry, Edit, Copy
  - **Asistente**: Copy, Like, Dislike, Retry
- **Bloques colapsables de herramientas**:
  - "Vio 2 archivos" (clickeable para expandir)
  - "Web buscada" (clickeable)
  - "Ejecuto un comando, archivo creado"
  - Patron: icono + descripcion + chevron, se expanden inline
- **Artifacts inline**: Tarjetas con icono + titulo + tipo + botones (Descargar, Copiar)
- **Truncamiento en mobile**: Mensajes largos de usuario muestran "Mostrar mas"

### ChatGPT.com
- **Mensajes de usuario**: Burbuja gris/beige alineada a la derecha
- **Mensajes de asistente**: Sin burbuja, texto negro, alineado a la izquierda
- **Markdown completo**: Similar a Claude — headings, bold, listas, tablas
- **Code blocks**: Header con lenguaje ("Bash") + icono + boton copiar, fondo oscuro
- **Citations inline**: Badge tipo "opencode.ai +2" clickeable (abre fuentes)
- **Acciones en mensajes**: Aparecen al hover debajo del mensaje
  - Copy, Like, Dislike, Read aloud, Share, More
- **Sin bloques colapsables de herramientas**: Las tool calls no son visibles como en Claude
- **Canvas**: Panel lateral que se abre para editar codigo/documentos colaborativamente

### Ideas para /plan
1. **Tool-use blocks colapsables**: Mostrar las acciones del agente (busqueda web, lectura de archivos, creacion de work items) como bloques colapsables tipo Claude
2. **Thinking indicator**: Ya implementado — asegurar que sea collapsable como en Claude
3. **Acciones contextuales por mensaje**: Copy + feedback (like/dislike) + retry en hover
4. **Tarjetas de work items inline**: Cuando el agente propone work items, mostrarlos como tarjetas tipo artifact con preview + "Crear en board"
5. **Citations de seeds**: Cuando el agente referencia una seed, mostrar badge inline clickeable

---

## 6. Panel Lateral (Artifacts / Canvas)

### Claude.ai — Panel de Artefactos
- **Activacion**: Click en una tarjeta de artefacto inline en el chat
- **Layout**: Split 50/50 (chat izquierda, artifact derecha)
- **Header**: Titulo del artifact + "..." opciones + "Copiar" + "X" cerrar
- **Toggle Vista/Codigo**: Tabs con iconos (ojo = preview, </> = codigo)
- **Copiar**: Boton prominente para copiar todo el contenido
- **Render completo**: Markdown con headings, listas, tablas, code blocks con syntax highlight
- **Efecto sidebar**: Al abrir el artifact, el sidebar colapsa a iconos automaticamente
- **Acciones bottom**: "Cerrar" + "Compartir" como floating buttons

### ChatGPT.com — Canvas
- **Activacion**: Se abre automaticamente cuando GPT genera contenido largo o cuando el usuario lo pide
- **Layout**: Split similar (chat izquierda, canvas derecha)
- **Edicion inline**: Permite editar el contenido directamente en el canvas
- **Herramientas**: Barra lateral con opciones de edicion (ajustar longitud, simplificar, etc.)
- **Versionado**: Historial de versiones del documento

### Ideas para /plan (MUY RELEVANTE)
1. **Panel de Preview de Propuesta**: Cuando el agente genera una propuesta de work items, abrir un panel lateral derecho con:
   - Tree view de la estructura propuesta (Epic > Feature > Story > Task)
   - Toggle entre "Vista arbol" y "Vista detalle"
   - Botones de accion: "Crear todo", "Modificar", "Rechazar"
   - Edicion inline de titulos y descripciones
2. **Panel de Seeds**: Usar el panel derecho para mostrar el detalle de una seed seleccionada (ya existe seed-detail-panel pero podria integrarse mejor en el layout split)
3. **Colapso automatico del sidebar**: Cuando se abre el panel derecho, el sidebar de sesiones debe colapsar automaticamente

---

## 7. Streaming y Feedback Visual

### Claude.ai
- **Streaming word-by-word**: El texto aparece palabra a palabra
- **Bloques de herramientas**: Los bloques "Vio 2 archivos", "Web buscada" aparecen como progress indicators durante la ejecucion
- **Stop button**: No visible en el snapshot pero existe — reemplaza el boton de enviar
- **"Ir al final"**: Boton flotante con flecha abajo cuando hay contenido no visible
- **Auto-scroll**: Sigue el streaming automaticamente, se detiene si el usuario hace scroll manual

### ChatGPT.com
- **Streaming similar**: Palabra a palabra con cursor parpadeante
- **Indicador de pensamiento**: Animacion circular cuando el modelo esta "pensando"
- **Stop button**: Cuadrado negro que aparece durante la generacion
- **Scroll to bottom**: Flecha abajo similar a Claude
- **Regenerar**: Boton "Retry" al final del ultimo mensaje

### Ideas para /plan
1. **Progress steps durante ejecucion**: Ya implementado con streaming-activity-indicator — mejorar para mostrar fases como:
   - "Analizando seeds..."
   - "Generando preguntas..."
   - "Procesando respuestas..."
   - "Creando propuesta..."
2. **Auto-scroll inteligente**: Ya implementado con use-auto-scroll — mantener
3. **Stop button visible**: Boton prominente para detener la generacion
4. **Thinking block collapsable**: Ya implementado — asegurar UX tipo Claude (expandir/colapsar con animacion)

---

## 8. Responsive / Mobile

### Claude.ai
- **Breakpoint principal**: ~768px
- **Sidebar**: Desaparece completamente, se accede via hamburger menu
- **Topbar minimal**: Solo iconos (sidebar toggle + notificaciones)
- **Input**: Full width con mismos controles
- **Categorias**: Se envuelven en 2 lineas
- **Mensajes largos**: Se truncan con "Mostrar mas"
- **Artifacts**: Reemplazan toda la vista (no hay split en mobile)

### ChatGPT.com
- **Breakpoint similar**: ~768px
- **Sidebar overlay**: Se desliza desde la izquierda como drawer
- **Topbar**: Hamburger + modelo + iconos
- **Input**: Full width, botones de voz mas prominentes
- **Canvas**: Reemplaza toda la vista en mobile

### Ideas para /plan
1. **Sidebar drawer en mobile**: El sidebar de sesiones debe ser un drawer con overlay
2. **Input floating**: Mantener input siempre visible y fijo abajo
3. **Seeds como bottom sheet**: En mobile, mostrar seeds seleccionadas como bottom sheet en vez de panel lateral
4. **Panel de preview full screen**: La propuesta de work items ocupa toda la pantalla en mobile con navegacion por tabs

---

## 9. Comparativa de Features Exclusivas

| Feature | Claude.ai | ChatGPT.com | Relevancia para /plan |
|---------|-----------|-------------|----------------------|
| **Artifacts (side panel)** | Si — preview markdown + codigo | Canvas — edicion inline | ALTA — Para preview de propuestas |
| **Tool-use blocks colapsables** | Si — muy detallados | No visibles | ALTA — Mostrar acciones del agente |
| **Categorias de prompts** | Si — tabs en empty state | No | MEDIA — Quick actions para modos |
| **GPTs personalizados** | No | Si — con avatares en sidebar | BAJA |
| **Proyectos con contexto** | Si — proyectos con archivos | Si — proyectos con instrucciones | MEDIA — Seeds como contexto |
| **Group chat** | No | Si — chat colaborativo | BAJA (futuro) |
| **Incognito/Temporal** | Si — boton discreto | Si — "Chat temporal" | BAJA |
| **Code section** | Si — seccion dedicada a codigo | Codex — herramienta separada | BAJA |
| **Hint "/ para habilidades"** | Si | No | MEDIA — Slash commands |
| **Voice input prominente** | Si | Si (mas prominente) | YA IMPLEMENTADO |
| **Selector de modelo inline** | Si — junto al input | Si — en la topbar | YA IMPLEMENTADO |
| **Pinned conversations** | No visible | Si — icono de pin | MEDIA |
| **Citations inline** | No | Si — badges de fuentes | ALTA — Para referencias a seeds |

---

## 10. Recomendaciones Prioritarias para /plan

### Alta Prioridad
1. **Panel split con preview de propuesta**: Implementar layout 3-columnas con panel derecho para preview de work items generados (tree view interactivo)
2. **Tool-use blocks colapsables**: Mostrar las acciones del agente como bloques expandibles/colapsables (estilo Claude)
3. **Citations de seeds inline**: Cuando el agente referencia una seed, badge clickeable que abre el detalle
4. **Acciones por mensaje**: Copy, feedback (like/dislike), retry en hover
5. **Scroll-to-bottom flotante**: Boton prominente cuando hay contenido no visible

### Media Prioridad
6. **Quick actions en empty state**: Tabs/botones para modos (Brainstorm, Refinar, Crear desde Seeds)
7. **Saludo personalizado**: Greeting contextual con nombre + seeds pendientes
8. **Busqueda de sesiones con Cmd+K**: Shortcut global
9. **Pin de sesiones**: Fijar sesiones importantes
10. **Slash commands**: "/" para comandos rapidos en el input

### Baja Prioridad (Futuro)
11. **Chat colaborativo**: Multiple usuarios en una sesion de planificacion
12. **Modo incognito/temporal**: Sesiones que no se guardan
13. **Agrupacion temporal en sidebar**: Hoy, Esta semana, Anteriores

---

## 11. Hallazgos Adicionales del Web Research

### Claude.ai — Features avanzadas descubiertas

**Paleta de colores de marca:**
- Crail (Terracotta Orange): `#C15F3C` — acento principal, transmite calidez
- Pampas: `#F4F3EE` — fondos crema
- Dark mode: mantiene calidez ("conversacion nocturna, no terminal fria")
- CSS variables: `oklch(0.70 0.14 45)` para terracotta, `oklch(0.97 0.02 70)` para crema

**Outline para respuestas largas:**
- Genera un indice/resumen clicable al inicio de mensajes largos (20+ paginas)
- Permite saltar a secciones especificas
- Muy util para propuestas largas de planificacion

**Cowork (Enero 2026):**
- Modo agente autonomo en Claude Desktop
- Task Dispatch para mobile/desktop
- 38+ conectores (Gmail, Drive, Notion, Slack)
- Relevante: concepto de tareas asincronas delegadas

**Inline Interactive Visualizations (Marzo 2026):**
- Visualizaciones interactivas directamente en el chat (NO en artifacts)
- HTML/SVG, no imagenes
- Interaccion: click, hover tooltips, sliders, toggles, zoom
- Se activan automaticamente o con "visualiza esto", "dibuja un diagrama"
- Diferentes de artifacts: son temporales, contextuales, in-chat

**Skills System (Marzo 2026):**
- Templates de workflow persistentes
- Gestion de skills a nivel organizacion

**@ Mentions en Projects:**
- `@filename` para referenciar archivos del proyecto
- Tab completion para seleccion rapida
- Las referencias aparecen inline en el compositor

**Tone/Length controls:**
- Dropdown en el input: Formal/Casual, Short/Detailed

### ChatGPT.com — Features avanzadas descubiertas

**Canvas — Detalle de activacion:**
1. Automatica: se abre con textos largos (10+ lineas) o tareas de codigo
2. Manual: "use canvas", "open a canvas"
3. Comando: `/canvas` en el compositor

**Canvas Toolbar (context-sensitive):**
- *Escritura*: Suggest Edits, Adjust Length (slider), Change Reading Level (K-Graduate), Add Final Polish, Add Emojis
- *Codigo*: Review Code, Add Logs, Add Comments, Fix Bugs, Port to Language
- Historial de versiones con flechas adelante/atras
- "Show changes" para ver diff (adiciones/eliminaciones)

**Model Tier System (Febrero 2026):**
- Instant (respuestas rapidas) / Thinking (tareas complejas) / Pro (mas capaz)
- "Auto" que transiciona entre modos segun complejidad de la query

**January 2026 Visual Update:**
- "At-a-glance visuals" para preguntas cotidianas
- Highlighting inline de personas, lugares, productos importantes
- Modulos visuales interactivos para formulas y variables
- Mini editor toolbar al seleccionar texto (similar a Word/Gmail)

**@ GPT Mentions:**
- `@GPTName` para invocar GPTs personalizados mid-conversation
- El GPT invocado recibe todo el contexto de la conversacion
- Permite encadenar multiples GPTs en un solo chat

**Shared Projects (2025-2026):**
- Multiples usuarios colaborando en un proyecto
- Disponible en Free, Plus, Pro, Go

---

## 12. Estado Actual de /plan en Almirant

La seccion ya implementa muchos patrones encontrados:
- Chat con mensajes + streaming
- Sidebar de sesiones (session-sidebar)
- Seeds panel como contexto
- Voice recorder / microfono
- Model selector
- Thinking block indicator
- Auto-scroll
- Question wizard para guiar la planificacion
- Work item preview tree
- Generation confirm panel

**Gaps principales vs Claude.ai/ChatGPT**:
- No hay panel split (artifacts/canvas) — la preview es inline o en dialogo
- No hay tool-use blocks colapsables
- No hay acciones de feedback por mensaje (like/dislike)
- No hay citations de seeds inline
- No hay quick actions en empty state tipo tabs de categorias
- No hay busqueda rapida de sesiones (Cmd+K)
- El responsive mobile puede mejorarse con drawer patterns
- No hay outline/indice para respuestas largas (patron Claude)
- No hay slash commands ("/brainstorm", "/refinar")
- No hay visualizaciones inline interactivas
- No hay @ mentions para seeds/work-items en el input
- No hay version history del plan generado (patron Canvas)
- No hay tone/length controls para ajustar el output del agente

---

## 13. Ideas Diferenciadoras para /plan (no copiadas, inspiradas)

Estas ideas combinan patrones de ambas plataformas con las necesidades especificas de Almirant:

### 1. Seed-aware Chat (unico de Almirant)
- El input muestra chips de seeds seleccionadas como contexto visible
- `@seed:titulo` para referenciar seeds inline en mensajes
- Cuando el agente menciona una seed, aparece badge clickeable que abre el detalle

### 2. Plan Preview Panel (inspirado en Artifacts + Canvas)
- Panel derecho que muestra el plan generado como arbol interactivo
- Epic > Feature > Story > Task con drag-and-drop para reordenar
- Version history con diff visual (como Canvas "show changes")
- Toggle vista arbol / vista kanban / vista tabla
- Botones de accion: "Crear todo en board", "Modificar", "Exportar"

### 3. Agent Activity Timeline (inspirado en tool-use blocks de Claude)
- Bloques colapsables que muestran lo que el agente esta haciendo:
  - "Analizando 3 seeds..."
  - "Investigando tecnologias..."
  - "Generando estructura de epic..."
  - "Creando 12 work items..."
- Cada bloque expandible para ver detalle

### 4. Planning Modes (inspirado en Model Tiers de ChatGPT)
- Quick: brainstorm rapido, output corto
- Deep: analisis profundo, output detallado con justificaciones
- Auto: detecta la complejidad y ajusta

### 5. Outline Navigation para propuestas largas
- Cuando la propuesta tiene 5+ secciones, generar indice flotante
- Click en seccion para hacer scroll automatico
- Tipo "table of contents" de la propuesta

### 6. @ Mentions para contexto
- `@seed:titulo` — referenciar una seed
- `@workitem:id` — referenciar un work item existente
- `@board:nombre` — especificar destino del output
- Tab completion con resultados del proyecto activo
