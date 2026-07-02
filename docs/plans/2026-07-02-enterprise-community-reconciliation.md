# Matriz de reconciliación enterprise → community

Fecha: 2026-07-02
Estado: borrador para revisión (no commitear hasta validar veredictos marcados REVISAR)

## 1. Contexto y método

- `almirant-community` es el repo canónico. Su historia es 1 commit squash (`3b34f39`, 2026-06-23) sin historia compartida con enterprise.
- `almirant-enterprise` quedó congelado en la práctica el **2026-04-28** (último commit real: `83e511814`, 2026-05-24). Community contiene el trabajo de la línea privada hasta el 2026-06-23 (migraciones hasta `0211` vs `0196` en enterprise).
- **Punto de divergencia**: ~2026-04-16/18. El barrido de similitud de árboles sobre la primera línea de padres de `enterprise/main` da el mínimo de delta (~1378 paths) en los merges del 2026-04-18, justo antes del rename organization→workspace (`e7bf2342c`, 04-19). Community absorbió casi todo lo anterior a esa fecha y siguió evolucionando por su cuenta (p. ej. el backlog drain del 04-28 enterprise SÍ está en community con sus propias migraciones 0196/0197).
- Método de triaje (reproducible):
  1. `git log --since=2026-04-01 --no-merges enterprise/main -- backend frontend services packages` → **875 commits**.
  2. Pase 1: por cada commit, muestreo de hasta 12 líneas añadidas distintivas y comprobación de pertenencia exacta contra el corpus completo del árbol de community (con normalización workspace→organization para neutralizar el rename).
  3. Pase 2 (para los no-encontrados): extracción de identificadores distintivos (funciones, columnas, canales, rutas) y búsqueda por substring en el corpus.
  4. Verificación manual con `grep -r` sobre el working tree de community para todos los grupos con veredicto ≠ YA-EN-COMMUNITY.
  5. Red de seguridad: `git diff --name-status 3b34f39 enterprise/main -- backend frontend services packages` → 1742 paths (659 solo-enterprise, 326 solo-community, 748 modificados, 9 renames) y clasificación fichero a fichero del remanente no explicado por commits.

## 2. Decisiones ya tomadas por el usuario

| Ítem | Decisión |
|---|---|
| Effort estimation (A-1938…A-1949) | **PORTAR** a community |
| Canonical session projection v2 (`0adf6d329`) | **PORTAR** |
| Terminal PTY (`2115e5b84`, `AGENT_TERMINAL_COMMAND_CHANNEL`) | **SE ELIMINA** (no portar, no mantener) |
| `services/scaler` | **CAPA-CLOUD** |
| `cms/` y `docs-site-nextra/` | Descartar |
| `docs-site/` | Extraer a repo aparte |
| Defaults ghcr hardcodeados | **CAPA** (vía env) |
| Workspace rename (`e7bf2342c`) | **PORTAR** (ya en curso en branch `refactor/rename-organization-to-workspace`, migración 0195 pendiente) |
| Dedup de preguntas por firma (`2f92de6a3`, `105ab7962`, `03244bef8`, `b38e3199c`, `649ab45f5`, `1122ff31f`) | **PORTAR** |
| renderQuestion multi-pregunta | **PORTAR** (ver `edddf10fd` + proyección v2, §4) |

## 3. Resumen ejecutivo

| Veredicto | Commits (aprox.) | Comentario |
|---|---|---|
| YA-EN-COMMUNITY | ~640 (543 confirmados automáticamente + parciales verificados) | Todo lo anterior al ~04-16 salvo superficie backoffice/feedback; también backlog drain, memoria/engram, pipeline bug-fix, MCP aliases, oauth-protected-resource |
| PORTAR | ~95 commits en 9 grupos | Ver §4 y §5. Incluye 1 fix de **seguridad** y 1 fix que ataca un bug conocido de community (cancel → bug_fix_attempts huérfanos) |
| CAPA-CLOUD | ~120 commits | Backoffice completo, feedback triage/clusters UI+API admin, waitlist, marketing/blog/landing (CMS), Stripe, scaler |
| OBSOLETO / SE-ELIMINA | ~15 commits | Terminal PTY, CLI TS archivado, navbar superseded, artefactos de linaje |

## 4. PORTAR — confirmados por el usuario

| sha | fecha | título | qué contiene | ficheros clave (enterprise) |
|---|---|---|---|---|
| `e7bf2342c` | 04-19 | refactor: rename organization to workspace across stack | Rename completo + migración `0195_rename_organization_to_workspace.sql` | 381 ficheros; ya replicado en branch community `refactor/rename-organization-to-workspace` |
| `ed4e1902d` | 04-20 | fix(frontend): centralize better auth workspace mapping | `BETTER_AUTH_ORGANIZATION_MODEL_NAME`, mapping de campos; acompaña al rename | `frontend/src/lib/better-auth-organization-schema.ts` (+test) |
| `b4a04808f` | 04-19 | fix(agent-jobs): use workspace_settings in claimJobs | Acompaña al rename en claimJobs | `agent-job-repository.ts` |
| `0adf6d329` | 04-28 | feat: add canonical session projection v2 | Proyección canónica v2 (`projection.ts` en `canonical-events`), `canonical-session-projection.ts`, `planning-session-recovery.ts`, cambios en agent-jobs/workers/planning-sessions routes | `backend/packages/canonical-events/src/projection.ts`, `backend/api/src/domains/ideation/planning-sessions/services/canonical-session-projection.ts`, `planning-session-recovery.ts` |
| `5cf416fbd` | 04-28 | fix: stabilize canonical events ci checks | Estabilización CI de la v2 (`timeoutDurationMs`) | tests de canonical-events |
| `2f92de6a3` | 04-28 | fix: dedupe planning questions after answer | `recentlyAnsweredPlanningQuestionKeys` en web-bridge | `services/web-bridge/src/event-consumer.ts`, `event-handlers.ts` |
| `105ab7962` | 04-28 | fix: preserve canonical question identity across runtimes | Identidad canónica de pregunta entre runtimes | `projection.ts`, `persistence.test.ts`, `planning-sessions.routes.test.ts` |
| `03244bef8` | 04-28 | fix: preserve claude question tool ids | `toolCallId` en question events del shim claude | `services/runner-claude/.../event-mapper.ts` |
| `b38e3199c` | 04-28 | fix(planning): dedupe overlapping replay snapshots | Dedup de snapshots de replay canónicos | `use-planning-session.ts`, `chunk-to-block-parser.ts` |
| `649ab45f5` | 04-28 | fix(planning): preserve replay timeline order | Merge job-output + session-events por timeline | `use-planning-session.ts` (+ reducer test) |
| `1122ff31f` | 04-28 | fix: dedupe planning replay after reconnect | Dedup de replay tras reconexión | `use-planning-session.ts`, `use-planning-session-replay-merge.test.ts` |
| `1cface247` | 04-28 | test: cover duplicate planning question flow | Cobertura del flujo de pregunta duplicada (acompaña al dedup) | tests frontend planning |
| `edddf10fd` | 04-19 | fix(auto): preserve structured planning questions in web bridge | **renderQuestion multi-pregunta**: preserva preguntas estructuradas (varias preguntas por bloque) en el web-bridge | `services/web-bridge/src/web-renderer.ts`, `backend/packages/stream-consumer/src/bridge-renderer.ts` |
| Grupo dedup 04-19 (precursores) | 04-19 | `174c95232` (prevent duplicate questionnaire replay, `normalizeQuestionSignature`), `be6ed944e` (firmas en storage `ANSWERED_QUESTION_SIGNATURES_STORAGE_KEY_PREFIX`), `8d69a1154` (`historicAnsweredQuestionTexts`), `ae1f09af2` (marcadores legacy `TRAILING_PARTIAL_LEGACY_PLANNING_MARKER_PATTERN`) | Primera oleada del dedup por firma; el set del 04-28 se apoya en ella | `use-planning-session.ts` y utilidades de firma |

### Effort estimation (grupo completo, PORTAR)

Evidencia de ausencia en community: `work_item_effort_estimates`, `effort_estimation_requests`, `effortEstimation*` → 0 hits. OJO: community ya tiene un sistema propio más ligero (`backend/packages/shared/src/agents/resource-estimation.ts` con `resolveResourceTier`/`estimatedMemoryMb`, `resource-forecast.ts`, `resource-timeline.ts`); el port debe reconciliarse con él, no duplicarlo. La migración `0192_effort_estimation.sql` NO puede copiarse (community va por 0211): regenerar con `bun run db:generate`.

| sha | fecha | título | ficheros clave |
|---|---|---|---|
| `a83eeb2b5` | 04-18 | DB schema (enums + 3 tablas + migración) | `schema/effort-estimation-requests.ts`, `effort-estimator-configs.ts`, `work-item-effort-estimates.ts` |
| `61ea8ee5b` | 04-18 | helper `isFeatureFlagEnabled` server-side | `posthog-service.ts` (0 hits en community) |
| `25df40d1f` | 04-18 | helper `generateStructuredJson` | `domains/ai/shared/services/structured-output.ts` |
| `9b5b70d35` | 04-18 | helper `computeContentHash` | `database/src/lib/content-hash.ts` (parcial: 2 hits en community, verificar) |
| `633eececb` | 04-18 | servicio effort-estimator con fallback heurístico | `effort-estimator.ts` |
| `f4e7c61e7` | 04-18 | sweeper in-process FOR UPDATE SKIP LOCKED | `effort-estimation-sweeper.ts` |
| `dc3122f17` | 04-18 | hook `enqueueEffortEstimation` en POST/PATCH work-items | `enqueue-effort-estimation.ts`, `work-items-typed-create` |
| `60a8bb942` | 04-18 | claimJobs respeta estimates con escape a los 10 min | `agent-job-repository.ts` |
| `a1a780a2e` | 04-18 | `resolveResourceTier` consume `estimatedMemoryMb`/`childCount` | runner/worker (reconciliar con resource-estimation de community) |
| `97fda67b8` | 04-18 | admin routes `/admin/effort-estimator` | community no tiene dominio admin: decidir nuevo home (¿instance-settings?) |
| `fb6377c14` | 04-18 | sweeper registrado + script backfill | `scripts/backfill-effort-estimations.ts`, `background.ts` |
| `ef4a105f5` | 04-18 | tab backoffice AI/Effort Estimator (UI) | UI de backoffice → re-ubicar en settings de community o dejar en capa cloud |

## 5. PORTAR — recomendaciones nuevas (no decididas aún por el usuario)

Ordenadas por prioridad. Evidencia = grep sobre el working tree de community con 0 hits salvo indicación.

| Prio | sha | fecha | título | por qué | ficheros clave |
|---|---|---|---|---|---|
| **P0 SEGURIDAD** | `1ebb59614` | 04-19 | fix(auto): miembro puede hacer admin a otro miembro | Guard `assertCanManageOrganizationMembers` en hook `before` de better-auth para endpoints sensibles (`/organization/update-member-role`…). Community usa la MISMA versión de better-auth (`^1.4.18`) y NO tiene el guard (`update-member-role`, `findMemberRole` → 0 hits). Escalada de privilegios reproducible salvo que better-auth lo haya corregido upstream — verificar y portar. | `frontend/src/lib/organization-member-management-guard.ts` (+test), hook en `frontend/src/lib/auth.ts` |
| **P0 BUG CONOCIDO** | `d06fe720d` | 04-19 | fix(agents): cascade job cancel to linked bug_fix_attempt | Community sufre exactamente este bug hoy (cancel de job deja `bug_fix_attempts` huérfanos; el zombie sweeper los marca failed 30 min después; ~19% de fallos cluster-scoped). `cascadeJobCancelToBugFixAttempt` → 0 hits en community. | `bug-fix-attempt-cancel-cascade.test.ts`, repos de agents |
| P1 | `14cca256b` | 04-19 | fix(feedback): recover cluster state when PR-merge webhook misses | Reconciliador `bug-fix-attempt-pr-reconciler.ts` + script `cleanup-cluster-pr-drift.ts`. Community tiene la capa de datos de clusters y el script hermano `audit-feedback-cluster-retry-drift.ts`, pero NO el reconciler. | `bug-fix-attempt-pr-reconciler.ts`, `cleanup-cluster-pr-drift.ts`, `github-webhook-handlers.ts` |
| P1 | Grupo cancel/reopen/backlog | 04-16 | A-1658…A-1666, A-1718, A-1811…A-1815: `1a27c5e9d` (POST /work-items/:id/cancel con cascada), `3d03e0b12` (DTOs), `2510317fd` (hooks), `532157d84` (CancelConfirmationDialog), `b43163643` (botones en ParentDetail), `ab7ed7824` (filtro board showCancelled), `837b77732` (filtrado includeCancelled), `993b6950c` (MCP tools `cancel_work_item`/`reopen_work_item`), `e1c8ecf78` (eventos timeline), `369baa83f` (`closeLinkedPullRequest`+`validateStopAction`), `7071395d0` (`pr_closed_unmerged`), `c3ecb3efa` (sync draft PR), `1d2ce3e39` (invariante sprint-archive), `f47792e6f` (tests precedencia), `c149b7c03` (página archivo completados), `3048db64e` (column roles) | Feature de producto completa ausente en community: `cancelledAt`/`sentToBacklogAt`/`includeCancelled`/`cancel_work_item` → 0 hits (los 5 hits de `cancelledAt` son de otro contexto). Requiere migración nueva. | `work-items.routes.ts`, `stop-action-helpers.ts`, `column-role-resolver.ts`, `cancel-confirmation-dialog.tsx`, `completed-items-*`, `use-work-item-actions.ts` |
| P2 | `3e4f3a32c` | 04-19 | runner reports observed model + tokens across runtimes | `observedOrRequestedModel`, `KNOWN_USAGE_EVENTS` → 0 hits; telemetría de coste/modelo más fiable | `services/runner/src/...` |
| P2 | `634c70af1` / `e8819f5a6` | 04-19 | surface provider failures in transcripts / restore output non-Codex | Diagnóstico de fallos de provider en transcript | runner |
| P2 | `3d8d7c154` | 04-19 | sync provider column with routing override codingAgent | Consistencia provider/codingAgent en jobs | `agent-job-provider-resolution.ts` (+test, solo-enterprise) |
| P2 | `77699d97c` | 04-28 | fix: handle missing ai config migration | `DEFAULT_PROJECT_AI_CONFIG`, `AI_CONFIG_UNAVAILABLE_MESSAGE` → 0 hits; degradación limpia si falta config AI | routes de ai-config |
| P2 | `eb3c0dd17` | 04-23 | fix(runner): persist INV-4 contract snapshot | Desbloquea re-runs de runner-implement (`contract-snapshot` → 0 hits) | runner orchestration |
| P3 | `e90b4b95a` | 04-19 | fix(sessions): derive model logo from model id | `inferProviderFromModelId` → 0 hits; UI menor | sessions frontend |
| P3 | `2c22255c8` | 04-12 | fix(auto): mezcla de respuestas recomendadas en preguntas agrupadas | `optionsPerQuestion` → 0 hits; emparenta con renderQuestion multi-pregunta | question wizard frontend |
| P3 | `7fe38db62` | 04-19 | fix(auth): preserve pending invitation until acceptance | REVISAR: 1 fichero, -30/+5 en auth; verificar si el flujo de invitaciones de community ya lo cubre | `frontend/src/lib/auth.ts` |
| P3 | `10041320d` | 04-21 | filter beta-flagged tabs in /plan mobile drawer | REVISAR contra el nav actual de community | plan mobile drawer |
| P3 | `0e549c878` | 04-21 | cursor pointer on parent kanban cards | Trivial | CSS kanban |

### PORTAR-SELECTIVO — oleada de fixes de planning/sesiones (04-18/19, ~30 commits `fix(auto)`)

Community divergió justo antes de esta oleada. Parte quedará subsumida por el port de la proyección v2; evaluar uno a uno DESPUÉS de portar v2 + dedup. Lista: `9cccd7726` (overflow URLs largas), `fe1bc9ab7` (mensajes duplicados, `snapshotEvents`), `f8a0cc179` (tool-use multilínea), `6932828a3` (guard prewarm WS), `56bac95ae` (ocultar markers [DONE] — `marker-parser.ts`/`marker-stripping.ts` solo-enterprise), `283bea44e` (seeds vacían sesión), `7c515156a`, `cc1f49c01` (mezcla de 2 sesiones), `e40a794ad` (HEREDOC como tool_call), `1c0838086` (cuadros vacíos), `6f19f957b` (`detect-qa-answer.ts`), `7a3f8b70f` (system prompt sobrescribe prompt), `04564ca0f` (fase repetida), `17f87cc23` (wizard setup filtra cuestiones ajenas), `d74cd343e` (refresh pierde items), `594fbb6af`/`0edd922e8`/`40eaedd6d`/`85db772cc` (cuestionario agrupado/repetido/bloqueado), `d60620b44` (spinner a 0), `95cbd2620` (replay pierde eventos tras remount), `b55982415` (model indicator), `4ebf53561` (spinner tras refresh), `37badc467` (scroll sidebar), `20bd84b1c` (prompts encolados), `18fe6fab7` (idle timeout cierra sesiones), `f407d4faa` (sesión bloqueada), `716b2b1ce` (skip approval), `af65ad9f3` (transcript incompleto), `48669fb86` (localizar seed fallback), `97f4d1ea2` (model fallback), `0e406c95b` (countdown obsoleto), `9b9192abc` (seed chips duplicados), `3f9806c6c` (filtro assignee alfanumérico), `986038384` (mapas de event types en tooltip), `a1225c57b` (run-now scheduled agent), `3ffa3f4e7` (runner-implement completion marker), `e5326d3b8`, `ca1784378`, `76438586e`.

Ficheros solo-enterprise asociados: `session-detail-view.utils.ts`, `session-sidebar.utils.ts`, `streaming-activity-indicator.utils.ts`, `detect-qa-answer.ts`, `marker-stripping.ts`, `remote-agent/src/core/marker-parser.ts`, `build-skill-insertion.ts`.

### Test-hardening (mock.module leaks) — PORTAR-SELECTIVO bajo valor

~15 commits del 04-16→19 (`d0a345356`, `59224779b`, `ed4756905`, `5804b755c`, `14432618f`, `b282428ad`, `75ceca8bd`, `d87353b19`, `024b829f6`, `c6df452b5`, `7411cb30d`, `2c575b693`, `f43bb63d3`, `e860c8f4c`, `4c83b38c2`, `3ef6ae3f3`, `ed851cb30`, `eeb5639f5`, `5b5dbe1ce`, `93479ce0f`). Community ya adoptó la convención (capturar real + restore en afterAll). Portar solo los que apliquen a suites que existan en community; los de suites de feedback/backoffice son N/A.

## 6. CAPA-CLOUD

Community conserva la **capa de datos** de feedback (schema + repositorios `feedback-*`), pero toda la superficie de administración vive en enterprise. Se queda en la capa cloud:

| Grupo | Alcance | Commits representativos | Ficheros clave |
|---|---|---|---|
| Backoffice (route group + API admin) | `(app-shell)/(backoffice)` completo (18 páginas: users, workspaces, waitlist, monitoring, security, settings, projects, analytics, feedback, bug-fix-attempts), dominios frontend `backoffice`/`quota`, dominios backend `admin`/`debug`/`waitlist`, repos `admin-*.repository.ts` | `6adbc2e97` (migración feedback a backoffice), `43db4349e`, `31d6f65aa` (redirects), `8cf2fed96` (admin/workers), `000e0fb47`+`d795ee991` (user tabs), `1cb6e2cea` (breadcrumb), `2e4aec4fb` (invitation URL admin) | 399 ficheros solo-enterprise bajo backoffice/admin |
| Feedback triage + clusters (UI y API admin) | Dominios frontend `feedback`/`feedback-triage`, lifecycle UI de clusters (A-E-86 waves 2-3, A-1818…A-1934), batch triage, launch/abort/dismiss investigation, incident bundle inspector UI | `081f7f1eb`, `33f105595`, `5cf5020df`, `2a47eebbb`, `5f4a2b4b0`, `57a1d7000`, `f2ccc8dd7`, `76f5798a2`, `a59328122`, `6455012b8`, `c85d475d1`, `39c8568ea`, `a62785783`, `9994c807e`, `a82e5491f`, `c6d1e944f`, `44f32bab9`, `ebc936602`, `76c69d07c`, `aab11df32`, `c0fe8ab01`, `f24ffa3f0`, `d7c399105`, `b2991cb56`, `5902f9056`, `c448a517a`, `853b7cde1`, `bc007b044`, `b46192a32`, `491433595`, `daab31b22`, `3e135a5fb`, `9c4ae9d14`, `02b4fac95`, `735c76d1f`, `b0c7eb95a`, `a187881ea`, `651b75ed0` (MCP `upsert_topic_for_item`), `d256da9d1` (MCP topics), `5c71bb532`, `8559a4a30`, `4e4dca299`, `84a5eea71` | MCP tools `feedback-triage.tools.ts`, `feedback-topics.tools.ts`, `bug-fix-attempts.tools.ts`, `debug.tools.ts`, `agent-jobs.tools.ts`, `lib/clustering.ts`, `lib/embeddings.ts`, skill `feedback-topic-merge-detector.md` |
| Marketing / blog / landing / waitlist | Route group `(marketing)` (landing, pricing, blog con Payload CMS, waitlist), dominios `blog`/`landing`/`waitlist`, `api/cms/revalidate` | `aa5c198fc`, `7f66abbb6` (emails waitlist), `83e511814` (bot probes en catch-all de marketing — el proxy de community ya tiene su propia protección) | ~150 ficheros; depende de `cms/` (decisión: descartar) |
| Stripe billing | Webhook + servicio Stripe (community factura por quotas/expenses, sin Stripe) | (anteriores a abril) | `domains/billing/stripe/*` |
| Scaler + runners multi-tenant | `services/scaler` (decisión usuario) + runners compartidos entre organizaciones | 2 commits SCALER del periodo + `d18bbe7e5` (pools por codingAgent), `cda8435bf` (shared runners any-org, `deriveAiProvider`), `af4c4458f` (shared runner monitoring) | `services/scaler/*` (13 ficheros) |
| Feedback widget in-app (dominio frontend `feedback`) | Enriquecimiento screenshot + debug metadata del widget interno del SaaS | `dd2756d51`, `b781b72a4` (`parseBrowserInfo`) | REVISAR: la idea (screenshot + metadata) es portable al `packages/feedback-widget` de community |

## 7. OBSOLETO / SE-ELIMINA

| sha | fecha | título | motivo |
|---|---|---|---|
| `2115e5b84` | 04-28 | feat(agent-terminal): live container terminal bridge (PTY) | **Decisión usuario: SE ELIMINA.** Ficheros a no portar y purgar de enterprise: `backend/api/src/shared/ws/agent-terminal-command-publisher.ts`, `frontend/src/domains/ai-planning/presentation/components/agent-terminal-panel.tsx`, `services/runner/src/session/agent-terminal-bridge.ts`, entradas `agent-terminal:*` en `ws-message-router.ts`/`ws-types.ts`, `AGENT_TERMINAL_COMMAND_CHANNEL` en env |
| `008fb13a3` | 04-24 | chore(cli): archive TS CLI | CLI movido a repo `almirant-cli` |
| `365270a7e` | 04-25 | chore(cli): remove duplicated CLI sources | ídem |
| `eb508b2d3` | 04-03 | navbar 3 dropdowns (`humansItems`/`createItems`/`agentsItems`) | Superseded: community rediseñó su navegación (0 hits, estructura distinta) |
| `c60e0a6f3` | 04-11 | apply changes (nav `INTERNAL_ROUTE_IDS`) | ídem |
| `6a105cb97` | 04-02 | beta-agents flag en navegación | Superseded por el nav de community |
| `466700352` | 04-18 | rename repo references to almirant-enterprise | Específico del linaje enterprise |
| `6b218abb2` | 04-18 | bump 0189 migration `when` | Artefacto de linaje de migraciones |
| `d3968085d`, `38c5b7053`, `d86934c67`, `13c5f31d0` | 04-05…04-14 | timestamps de journal de migraciones | Artefactos de linaje |
| `1ce1c4ecd` | 04-18 | ARRAY vs ROW en JSONB ?| overlap | Aplica al claim SQL del feedback enterprise; community reescribió el claim (REVISAR antes de descartar del todo) |
| `4ecb2aed2`, `795b381a0` | 04-12 | harden feedback claim timestamp / type-check | Community evolucionó el claim (`claimNextBugFeedbackItem` existe con otra implementación); `safeJsonTimestampSql` no necesario a priori |

## 8. YA-EN-COMMUNITY (agregado)

543 commits confirmados automáticamente (score de líneas ≥0.7 o identificadores ≥0.7) + parciales verificados a mano. Cubre esencialmente todo el rango 04-01 → 04-16. Spot-checks:

| sha | título | evidencia en community |
|---|---|---|
| `fe732106a` | native shared memory + engram import | `schema/agent-memory-telemetry.ts` presente |
| `0b5e00400` | pipeline bug triage y fix (A-F-389) | `bug-fix-attempts.ts`, `bug-fix-attempt-repository.ts` presentes |
| `1d2074e35` | cluster lifecycle Wave 1 (tipos + schema) | `schema/cluster-status-history.ts` presente |
| `8a66d62db` | backlog drain automation (04-28!) | `backlog-drain-repository.ts` + migraciones propias `0196/0197_backlog_drain_*` — prueba de que la línea community siguió absorbiendo trabajo tras la divergencia |
| `7eff9c5fd` | /api/mcp aliases para reverse proxies self-hosted | `isMcpPath` en `backend/api/src/index.ts` |
| `8e3fbf9ff` | JSON 404 en oauth-protected-resource | `oauth-protected-resource` en 4 ficheros |
| `f0f7bffa7` | propagar MC_API_KEY al bot auto-fix | `MC_API_KEY` en 4 ficheros |
| `c771951b6` | canonical events como paquete compartido | `backend/packages/canonical-events` existe (base sobre la que portar la v2) |

Reproducible con el script de triaje (corpus del árbol `3b34f39` + membership de líneas/identificadores con normalización workspace→organization).

## 9. Hallazgos del tree-diff (red de seguridad — deltas que el triaje por commits no cubría)

1. **Marketing/blog/landing/waitlist + Stripe son anteriores a abril**: ~150 ficheros solo-enterprise que ningún commit del rango explica. Veredicto CAPA-CLOUD (dependen de `cms/` Payload, que se descarta). El `e2e/blog-cms-smoke.md` y `api/cms/revalidate` van con ese grupo.
2. **Drift histórico de migraciones**: `0058-0064`, `0119-0121`, `0138-0139`, `0046`, `0070/0071`, `0075`, `0080`, `0085` difieren o solo existen en un lado (renumeración antigua). Sin acción — el linaje de community es el canónico. Consecuencia operativa: NINGUNA migración de enterprise se copia; siempre regenerar con drizzle sobre community (ya en 0211).
3. **`.env.example` divergentes** (backend root, api, api.production, database, frontend, runner ×2): contienen los defaults ghcr/cloud → decisión usuario: CAPA vía env. Revisar variable a variable al montar el wrapper.
4. **`lib/embeddings.ts` y `lib/clustering.ts` solo en enterprise**: community tiene los repositorios de clusters pero no estas libs — verificar dónde hace community el clustering (¿worker?) antes de dar el grupo feedback-cloud por cerrado.
5. **Artefactos basura commiteados en enterprise**: `frontend/test-results/`, `frontend/playwright-report/`, `services/runner/PUSH_DEBUG_LOG.md` → no portar nada.
6. **`services/runner/platform-config/.claude/settings.json`** solo-enterprise: revisar si el runner de community necesita el equivalente.
7. **`frontend/src/domains/github/presentation/components/github-missing-slug-card.tsx`** solo-enterprise: UI menor de GitHub sin commit clasificado en el rango — REVISAR (probable PORTAR trivial).
8. **Inventario solo-community (326 ficheros)** — evolución propia posterior a la divergencia, sin acción, pero confirma que community va por delante: dominio `instance` (23), dominio `handbook` (12), `services/updater` (14), dominios frontend `instance-settings`, `integration-batches`, `onboarding`, `contact`, `infrastructure/extensions` (9) + `shared/extensions`, MCP tools nuevos (error-fingerprint, error-recurrence, quota, handbook, integration-batches), scripts de backfill/preview.
9. **748 ficheros modificados en ambos lados**: mayormente (a) rename workspace/organization pendiente y (b) evolución de community. La dirección del port es enterprise→community SOLO para los grupos de §4/§5; para el resto community es la versión buena.

## 10. Notas operativas

- Working tree de community: limpio y en `main` en el momento de escribir este documento. Este fichero es nuevo y queda SIN añadir al índice (no commitear).
- Todos los ports que toquen schema deben regenerar migraciones en community (`bun run db:generate`), nunca copiar los `.sql` de enterprise (colisión de numeración 0192-0196 vs 0197-0211).
- El port del rename workspace ya está en curso en la branch `refactor/rename-organization-to-workspace` (worktree `almirant-rename-workspace`); `ed4e1902d` y `b4a04808f` deberían integrarse ahí.
- Orden sugerido de ejecución: (1) P0 seguridad `1ebb59614`; (2) P0 `d06fe720d` + `14cca256b` (bug conocido 19%); (3) projection v2 + dedup + renderQuestion (grupo coherente); (4) effort estimation; (5) cancel/reopen; (6) oleada selectiva de fixes de planning; (7) rename (branch existente).
