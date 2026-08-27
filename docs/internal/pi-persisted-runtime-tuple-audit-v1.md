# Pi persisted runtime tuple audit v1

This audit freezes how runtime selection is currently represented across six persisted surfaces. It does not redefine existing rows. The immediate conclusion is that Almirant does not yet persist one complete, atomic runtime tuple: defaults, nullable fields, copied values, fieldwise inheritance, and JSONB duplicates can disagree.

The normative machine-readable audit is `persistedSurfaceAudit` in `services/runner/test/fixtures/pi-0.84.2/capability-contract-v1.json`.

## Tuple under audit

The intended modern selection keeps these dimensions distinct:

```text
request
→ infrastructure provider lane
→ coding agent
→ AI provider
→ exact model
→ credential and endpoint identity
```

Existing surfaces frequently store only a subset. `provider` is an infrastructure/runtime lane, `codingAgent` selects the executable, and `aiProvider` plus `model` selects the AI API tuple. None may silently stand in for another.

## Surface summary

| Surface | Complete tuple? | Main conflict |
| --- | :---: | --- |
| `agent_jobs` | No | Top-level columns and `config` JSONB duplicate fields with different runner precedence. |
| `loops` | No | Coupled `provider` lane, validation gaps, and no `codex-cli` enum representation. |
| `scheduled_agent_configs` | No | Fieldwise precedence can assemble a tuple that was never validated atomically. |
| `work_items` | No | Stores coding agent and model but no provider or AI provider. |
| `system_settings.agent_routing` | No | Unversioned partial JSONB entries mix runtime fields and connection identity. |
| `agent_native_events` | No | Typed columns record partial envelope provenance while native payloads can repeat conflicting values. |

## 1. `agent_jobs`

**Locations**

- `backend/packages/database/src/schema/agent-jobs.ts`
- `backend/packages/database/src/repositories/agents/agent-job-repository.ts`
- `services/runner/src/shared/job-helpers.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `provider` | No database default recorded | Not null, no default |
| `coding_agent` | `claude-code` | Not null |
| `ai_provider` | `anthropic` | Not null |
| `model` | `claude-opus-4-8` | Not null |
| `config` | No default recorded | Not null |

Duplicate representations:

- `coding_agent` and `config.codingAgent`
- `model` and `config.model`

Current runner precedence is internally inconsistent: `config.codingAgent` wins for coding agent, while top-level `model` wins for model. `createJob` resolves top-level fields without rewriting their duplicate JSONB fields, so inconsistent pairs can be persisted. Rows created before dedicated runtime columns may still depend on JSONB values and column defaults.

## 2. `loops`

**Locations**

- `backend/packages/database/src/schema/loops.ts`
- `backend/api/src/domains/agents/routes/loops.routes.ts`
- `backend/api/src/mcp/tools/loops.tools.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `provider` | `claude-code` | Not null |
| `coding_agent` | `claude-code` | Not null |
| `ai_provider` | `anthropic` | Not null |
| `model` | None | Nullable |
| `reasoning_level` | None | Nullable |

There is no duplicate representation within the loop row. Loop columns are the persisted source and are projected into each iteration job at dispatch.

The conflict is at admission and projection: REST and MCP validation omit Google even though the `ai_provider` enum supports it, and `provider` remains a coupled runtime lane. The loop `coding_agent` enum cannot represent the legacy value `codex-cli`; this differs from surfaces where that alias can be normalized.

## 3. `scheduled_agent_configs`

**Locations**

- `backend/packages/database/src/schema/scheduled-agent-configs.ts`
- `backend/packages/database/src/repositories/agents/scheduled-agent-config-normalization.ts`
- `backend/packages/shared/src/agents/scheduled-runtime-precedence.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `provider` | No database default recorded | Not null |
| `coding_agent` | `claude-code` | Nullable despite the default |
| `ai_provider` | None | Nullable |
| `ai_model` | None | Nullable |
| `reasoning_level` | None | Nullable |
| `enabled` | `false` | Not specified by this audit |
| `target_config` | Empty object | Not specified by this audit |

The resolved runtime is duplicated downstream: dispatch copies it into `agent_jobs` top-level fields and selected config metadata.

Execution resolves each field independently in this order:

1. rule;
2. schedule;
3. work item;
4. project;
5. connection;
6. defaults.

That fieldwise precedence can combine coding agent, AI provider, and model from different sources into a tuple that no boundary has validated atomically. The varchar `coding_agent` column accepts `codex-cli`; repository reads and writes normalize it to `codex`.

## 4. `work_items`

**Locations**

- `backend/packages/database/src/schema/work-items.ts`
- `backend/packages/shared/src/agents/scheduled-runtime-precedence.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `coding_agent` | None | Nullable |
| `ai_model` | None | Nullable |
| `ai_provider` | Not present | Not present |
| `provider` | Not present | Not present |

Work-item values are a fieldwise middle layer: below schedule values and above project defaults. Null means inherit. Unknown future coding-agent enum values cannot be stored until the enum expands.

The representation is incomplete by construction. A work item can override coding agent and model but cannot preserve the corresponding AI provider or infrastructure lane. Those overrides are also duplicated into the dispatch result when a scheduled job is created.

## 5. `system_settings.agent_routing`

**Locations**

- `backend/packages/database/src/schema/system-settings.ts`
- `backend/packages/database/src/repositories/agents/agent-job-repository.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `agent_routing` | Empty object | Not null |
| `job_fallback_coding_agent` | `claude-code` | N/A: hardcoded fallback |
| `job_fallback_ai_provider` | `anthropic` | N/A: hardcoded fallback |
| `job_fallback_model` | `claude-opus-4-8` | N/A: hardcoded fallback |
| `entry.codingAgent` | None | Nullable |
| `entry.aiProvider` | None | Nullable |
| `entry.model` | None | Nullable |
| `entry.providerConnectionId` | None | Nullable |

Explicit `createJob` input wins. Internal-skill routing then supplies missing fields independently, followed by hardcoded defaults. Routing values are copied into `agent_jobs` columns, while `providerConnectionId` is copied into `config` JSONB.

The map is unversioned and permits partial, internally inconsistent runtime and connection combinations. `aiProvider` remains for rows created before connection-owned provider selection, creating another legacy representation that cannot be assumed to match the selected connection.

## 6. `agent_native_events`

**Locations**

- `backend/packages/database/src/schema/agent-native-events.ts`
- `backend/packages/database/src/repositories/agents/native-event-repository.ts`

| Field | Default | Nullability |
| --- | --- | --- |
| `source_format` | `sse` | Not specified by this audit |
| `received_at` | Database now | Not specified by this audit |
| `provider` | None | Nullable |
| `coding_agent` | None | Nullable |
| `runtime_session_id` | None | Nullable |
| `payload` | No default recorded | Not null |
| `ai_provider` | Not present | Not present |
| `model` | Not present | Not present |

The native payload may repeat provider, coding agent, model, usage, and terminal data without typed precedence. Typed columns must remain envelope provenance; payload is native evidence and must not silently override them.

Historical source formats include `sse`, `opencode-sse`, and Codex-shaped native event payloads. There is no Pi source-format contract yet, and the table cannot distinguish requested, resolved, and observed AI provider/model values.

## Duplicate and precedence rules to preserve during migration

| Situation | Current behavior that legacy reads must preserve |
| --- | --- |
| Job coding-agent conflict | `config.codingAgent` wins over top-level `coding_agent` in the current runner path. |
| Job model conflict | Top-level `model` wins over `config.model`. |
| Scheduled execution | Resolve rule → schedule → work item → project → connection → defaults, independently per field. |
| Routing | Explicit create input → internal-skill route per field → hardcoded defaults. |
| Loop dispatch | Loop columns are projected into the iteration job. |
| Native events | Typed columns are envelope provenance; native payload remains evidence, not an implicit override. |

These rules are legacy compatibility facts, not the desired modern write contract. New writes must not create another precedence layer.

## `codex-cli` legacy handling

`codex-cli` is not uniform across persistence:

- `scheduled_agent_configs.coding_agent` is varchar and accepts `codex-cli`; repository normalization maps it to canonical `codex` on reads and writes.
- The loop coding-agent enum cannot represent `codex-cli`.
- Existing aliases and rows must remain readable through a dedicated legacy anti-corruption path.
- Modern requests and persisted resolved selections use canonical coding-agent values; an unknown non-empty explicit value must be rejected, not treated as missing and not silently mapped to another executor.

Alias normalization must not rewrite AI provider, model, connection, or infrastructure provider as a side effect.

## Consequences for WU-2

WU-2 must centralize compatibility without changing these persisted facts prematurely:

1. Define distinct `RequestedRuntimeSelection` and immutable, versioned `ResolvedRuntimeSelection` values covering infrastructure provider, coding agent, AI provider, exact model, auth class, credential/endpoint binding identity, and resolution provenance.
2. Keep one environment-neutral registry as the only owner of tuple admission, defaults, reasoning support, capabilities, and typed rejection reasons.
3. Resolve inherited fields first, then validate the resulting tuple atomically. Do not silently rewrite an explicit field to make the tuple valid.
4. Preserve exact, case-sensitive model IDs.
5. Isolate current defaults, null inheritance, top-level/JSONB precedence, and `codex-cli` normalization in a legacy anti-corruption adapter.
6. Reject every unknown non-empty explicit coding agent. Legacy fallback is allowed only when a value is genuinely absent.
7. Keep `provider`, `codingAgent`, `aiProvider`, and `model` independent; adapter-specific Pi provider IDs are resolved output, never free-form input.
8. Add fixtures for every default, nullable row, duplicate mismatch, fieldwise source combination, and alias described above.

## Consequences for WU-5

WU-5 must expand persistence without rewriting old meaning:

1. Add `pi` with an isolated expand-only enum migration; do not replace enums or update existing rows.
2. Preserve all existing defaults and nullability unless a separately reviewed migration explicitly changes them.
3. Persist one complete resolved selection for modern writes and define one explicit boundary between modern and legacy records.
4. Define top-level versus JSONB authority for modern jobs; old mismatched rows must still read through the frozen legacy precedence.
5. Round-trip Pi across jobs, loops, schedules, work items, remote-agent payloads, and native events without deriving AI provider/model from the infrastructure lane.
6. Retain the `codex-cli` compatibility adapter where the underlying surface can contain it; do not force the alias into enums that never represented it.
7. Record requested, resolved, and observed values separately. Native event payloads remain bounded evidence and cannot override typed selection provenance.
8. Cover pre-migration defaults, nulls, aliases, duplicate conflicts, unknown future values, and exact Pi tuple round trips.
9. Treat the enum expansion as non-downgradable. Application rollback disables Pi admission and drains or quarantines Pi jobs; it does not remove `pi` or rewrite stored rows.

Until WU-2 and WU-5 implement these consequences, no persisted surface can be treated as an authoritative complete Pi runtime tuple.
