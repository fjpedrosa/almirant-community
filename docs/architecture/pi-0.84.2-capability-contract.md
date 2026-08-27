# Pi 0.84.2 capability contract

This document freezes the evidence-backed boundary for Pi 0.84.2 and records the narrow production admission decision. Exactly one tuple is runtime-verified and enabled: `(pi, zai, glm-5.3, api_key)` with no optional Pi capability. Every other Pi provider/model/auth/capability/custom-provider row remains disabled.

The machine-readable source of truth is `services/runner/test/fixtures/pi-0.84.2/capability-contract-v1.json`; framing and lifecycle examples are versioned beside it.

## Runtime identity and invocation

| Field | Frozen value |
| --- | --- |
| Package | `@earendil-works/pi-coding-agent` |
| Version | `0.84.2` |
| Node engine | `>=22.19.0` |
| Binary | `pi` |
| Mode | `rpc` |
| Config directory | New and empty for each session |
| Session persistence | Disabled |
| Project resources | Disabled |
| Network-dependent package behavior | Offline |
| Telemetry | Disabled |
| Version checks | Disabled |

Invoke the pinned binary with these exact arguments, in order:

```text
pi
--mode rpc
--no-session
--offline
--no-context-files
--no-extensions
--no-skills
--no-prompt-templates
--no-themes
--no-approve
```

Set only the frozen runtime controls below; `runtime-config` denotes the per-session empty config directory supplied by the runtime adapter.

| Variable | Value |
| --- | --- |
| `PI_CODING_AGENT_DIR` | `runtime-config` |
| `PI_OFFLINE` | `1` |
| `PI_SKIP_VERSION_CHECK` | `1` |
| `PI_TELEMETRY` | `0` |

Provider credentials are not part of this static environment table. After admission, the runner requires exactly one typed bundle bound to `zai` and `api_key`, exports its credential only as `ZAI_API_KEY`, and pins `PI_PROVIDER=zai` plus `PI_MODEL=glm-5.3`. Flat legacy key fields, job-supplied Pi controls, and endpoint overrides are not Pi fallbacks.

## Sterile configuration and resource policy

Each process receives a newly created empty Pi config directory. It must not reuse user or previous-session state. `--no-session` prevents Pi session persistence, and all project-discovered context files, extensions, skills, prompt templates, and themes are disabled. Offline mode, telemetry disablement, and version-check disablement prevent optional discovery and reporting behavior.

These controls reduce ambient input; they do not create a sandbox, permission boundary, or read-only guarantee. OS/container policy remains responsible for filesystem, process, and network isolation.

## JSONL framing

| Rule | Contract |
| --- | --- |
| Record delimiter | LF (`0x0A`) |
| CRLF input | Accepted; the CR immediately before LF is stripped |
| U+2028/U+2029 | Content, not record delimiters |
| Record shape | Non-null JSON object only |
| Inbound record maximum | 262,144 bytes |
| Outbound record maximum | 4,194,304 bytes |
| Size accounting | UTF-8 record bytes, excluding the delimiter |
| Final LF | Required |
| Protocol failure scope | Entire session |

Malformed JSON fails with `PI_RPC_MALFORMED_JSON`; null, arrays, and primitives fail with `PI_RPC_NON_OBJECT`; oversized records fail with `PI_RPC_RECORD_TOO_LARGE`; and EOF without a final LF fails with `PI_RPC_UNTERMINATED_RECORD`.

### Intentional final-LF discrepancy

Pi 0.84.2's `dist/modes/rpc/jsonl.js` splits on LF, strips an optional CR, and accepts a partial final record at EOF. Almirant is deliberately stricter: both accepted fixture streams and emitted records must end in LF. The stricter reader turns a partial EOF record into a session-fatal `PI_RPC_UNTERMINATED_RECORD` instead of guessing whether truncated output was complete.

## RPC command and lifecycle contract

Every command carries a string correlation ID and receives exactly one response with the same ID and command name.

| Command | Required response behavior |
| --- | --- |
| `get_state` | Exactly one correlated response |
| `set_model` | Exactly one correlated response |
| `prompt` | Exactly one correlated response before agent events |
| `abort` | Exactly one correlated acknowledgement; not terminal |
| `get_session_stats` | Exactly one correlated response; query after settlement for authoritative session totals |

A normal turn follows this order:

```text
get_state response
set_model response
prompt response
agent_start
turn_start
message_start
message_update (cumulative usage snapshots)
thinking/text/tool lifecycle
message_end (authoritative per-message usage)
turn_end
agent_end
agent_settled
get_session_stats response
```

`agent_end` is explicitly nonterminal. `agent_settled` is the sole normal terminal and must be represented exactly once. A duplicate `agent_settled` is ignored after the first terminal transition. Prompt acknowledgement, abort acknowledgement, message completion, turn completion, and `agent_end` must never be promoted to settlement.

The versioned lifecycle fixture is schema-derived (`runtimeCaptured: false`), not proof of live package behavior. It demonstrates string correlation IDs, cumulative update snapshots, thinking/text/tool phases, final message usage and cost, one settlement, nonterminal abort acknowledgement, and post-settlement session totals.

## Cancellation and process boundaries

The frozen contract distinguishes known adapter policy from unresolved runtime behavior:

- `abort` acknowledgement means only that the command was acknowledged; it does not settle the turn.
- Cancellation completes only on `agent_settled` or an abnormal terminal class.
- Cancellation while a tool is running, queued-prompt behavior, subprocess/process-group membership, TERM/KILL escalation, and confirmed reaping are not runtime-verified in WU-1.
- Exit code `0` is not normal completion when no settlement was observed.
- Unexpected process exit, process signal, stdin failure, timeout, cancellation, and protocol failure poison the session and use the typed terminal codes below.
- WU-3 must prove cancellation, shutdown, and zero surviving process-group members before enabling the adapter.

| Abnormal class | Code |
| --- | --- |
| Protocol error | `PI_RPC_PROTOCOL_ERROR` |
| Process exit | `PI_RPC_PROCESS_EXIT` |
| Process signal | `PI_RPC_PROCESS_SIGNAL` |
| Stdin error | `PI_RPC_STDIN_ERROR` |
| Timeout | `PI_RPC_TIMEOUT` |
| Cancelled | `PI_RPC_CANCELLED` |

## Usage authority and precedence

Usage is never reconstructed by summing stream updates.

1. Prefer the post-settlement `get_session_stats` whole-session aggregate. For a continued session, subtract the pre-turn whole-session baseline.
2. Otherwise use deduplicated authoritative usage from final `message_end` messages.
3. Otherwise report usage as unknown; never fill an unavailable metric with zero.

Streaming `message_update` usage is a cumulative snapshot. Final message usage is per-message. Reasoning tokens are an optional subset of output tokens, not an additional token category. Cache read/write, total tokens, and provider cost remain separate fields. Terminal usage and cost are handled exactly once.

## Authentication classes

| Auth class | Documentation candidate | Admission | Rejection code |
| --- | :---: | :---: | --- |
| `api_key` | Yes | Enabled and runtime-verified | None; tuple admission still requires exact `zai/glm-5.3` |
| `setup_token` | No | Disabled | `PI_AUTH_SETUP_TOKEN_DISABLED` |
| `provider_oauth` | No | Disabled | `PI_AUTH_PROVIDER_OAUTH_DISABLED` |
| `subscription` | No | Disabled | `PI_AUTH_SUBSCRIPTION_DISABLED` |

An API-key row requires one provider-specific key, the canonical environment-variable name below, the frozen provider endpoint, and an admitted exact model. Only Z.AI `glm-5.3` has that production evidence. Credentials are resolved only after registry admission, and Pi accepts no setup-token, provider OAuth, subscription, `openai-codex`, flat legacy-key, or endpoint-override alias.

## API-key provider/model candidates

Candidate model IDs are exact and case-preserving. Only the Z.AI `glm-5.3` model row has `runtimeVerified: true` and `admissionEnabled: true`; all other candidate rows remain false.

| Provider | Credential variable | Endpoint | Pi API | Candidate models |
| --- | --- | --- | --- | --- |
| Anthropic (`anthropic`) | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | `anthropic-messages` | `claude-opus-5`, `claude-opus-4-8`, `claude-fable-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-haiku-4-5` |
| OpenAI API (`openai`) | `OPENAI_API_KEY` | `https://api.openai.com/v1` | `openai-responses` | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.3-codex`, `gpt-4.1`, `gpt-4.1-mini` |
| Google (`google`) | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta` | `google-generative-ai` | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` |
| Z.AI (`zai`) | `ZAI_API_KEY` | `https://api.z.ai/api/coding/paas/v4` | `openai-completions` | `glm-5.3`, `glm-5.2`, `glm-5-turbo`, `glm-4.7` |
| xAI (`xai`) | `XAI_API_KEY` | `https://api.x.ai/v1` | `openai-completions` for both candidates; provider also exposes `openai-responses` | `grok-4.3`, `grok-build-0.1` |

Static intersection exclusions are part of the decision, not implied support:

| Provider | Excluded target models | Reason |
| --- | --- | --- |
| Anthropic | None | Every listed target model is present in the pinned Pi static catalog. |
| OpenAI API | None | Every listed target model is present in the pinned Pi static catalog; OAuth/subscription `openai-codex` remains excluded. |
| Google | None | Every listed target model is present in the pinned Pi static catalog. |
| Z.AI | `glm-5.1`, `glm-5`, `glm-5v-turbo`, `glm-4.7-flashx`, `glm-4.7-flash`, `glm-4.6`, `glm-4.5`, `glm-4.5-air`, `glm-4.6v`, `glm-4.6v-flashx`, `glm-4.6v-flash`, `glm-ocr` | Absent from Pi 0.84.2's static Z.AI Coding Plan catalog or not compatible with this endpoint candidate. |
| xAI | `grok-4.20-reasoning`, `grok-4.20-multi-agent`, `grok-4.20` | Target aliases are absent from Pi 0.84.2's static xAI catalog. Pi-only `grok-4.5` and `grok-4.6` are also outside the Almirant target catalog. |

Static catalog intersection is necessary but not sufficient. Z.AI `glm-5.3` is the sole row promoted after typed-credential, fixed-endpoint, adapter, and Pi RPC verification. Promotion of any additional row requires independent evidence and a registry/projection update.

## Disabled capabilities and custom providers

| Capability | State | Rejection code |
| --- | --- | --- |
| MCP | Disabled | `PI_CAPABILITY_MCP_DISABLED` |
| Browser | Disabled | `PI_CAPABILITY_BROWSER_DISABLED` |
| Extensions | Disabled | `PI_CAPABILITY_EXTENSIONS_DISABLED` |
| Sandbox | Disabled | `PI_CAPABILITY_SANDBOX_DISABLED` |
| Permission enforcement | Disabled | `PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED` |
| Read-only enforcement | Disabled | `PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED` |

Custom providers are disabled with `PI_CUSTOM_PROVIDER_DISABLED`. Free-form endpoint, header, environment, and command-resolution inputs are unsafe. Enablement requires a trusted profile plus redirect revalidation, egress policy, and secret policy; job input must never directly supply those values.

Admission fails before provider lookup or secret export. The capability fixture freezes the codes above and the sole admitted model; unsupported provider, model, auth, capability, and registry-version combinations receive typed rejection rather than fallback.

## Provenance

The contract records package-relative and repository-relative evidence only.

| Evidence | Establishes |
| --- | --- |
| Pi `package.json` | Package version, binary, and Node engine |
| Pi `README.md` | RPC mode, no built-in MCP, session/resource flags, and offline controls |
| Pi `docs/rpc.md` | Commands, responses, events, framing, message shapes, and session statistics |
| Pi `docs/json.md` | Delta-only stream events and authoritative final messages |
| Pi `docs/providers.md` | Credential classes, environment variables, and provider resolution |
| Pi `docs/models.md` | Custom-provider inputs, supported APIs, overrides, and unsafe resolution |
| Pi `docs/custom-provider.md` | Extension provider registration, OAuth, endpoints, headers, and command resolution |
| Pi `docs/environment-variables.md` | Offline, telemetry, version-check, config-directory, and session controls |
| Pi `docs/security.md` | Project trust is not a sandbox or permission boundary |
| Pi `docs/containerization.md` | Isolation must be supplied by an OS, VM, container, or policy boundary |
| Pi `docs/sessions.md` and `docs/session-format.md` | Ephemeral/persisted session behavior, message usage, and entries |
| Pi `docs/usage.md`, `docs/compaction.md` | Operational modes, project resources, and whole-session usage contributions |
| Pi `docs/extensions.md`, `docs/settings.md`, `docs/packages.md` | Executable extension/package resources, settings discovery, permissions, and `agent_settled` provenance |
| Pi `dist/modes/rpc/jsonl.js` | LF splitting, optional CR stripping, and permissive partial-EOF behavior |
| Pi `dist/modes/rpc/rpc-mode.js` | Response cardinality, abort acknowledgement, emitted events, and process shutdown |
| `@earendil-works/pi-ai/dist/types.d.ts` | Usage shape and reasoning-as-output-subset semantics |
| `@earendil-works/pi-ai/dist/providers/data` and provider modules | Pinned static model IDs, APIs, endpoints, and capabilities |
| `frontend/src/lib/ai-models-catalog.ts` | Almirant target model IDs used for static intersection |
| `backend/packages/database/src/schema` | Existing defaults, nullability, enums, duplication, and persistence gaps |

## Explicit non-goals

WU-1 does not:

- enable any Pi tuple other than `(pi, zai, glm-5.3, api_key)`;
- enable any optional Pi capability or claim that schema-derived lifecycle evidence alone verifies a runtime;
- support arbitrary provider/model strings, custom endpoints, headers, or environment overrides;
- support MCP, browser, extensions, sandboxing, permission enforcement, or read-only enforcement;
- treat Pi flags as an OS/container security boundary;
- prove cancellation during tools, process-group termination, or image behavior;
- change persistence, defaults, aliases, or legacy precedence;
- infer missing usage as zero, sum streaming snapshots, or accept completion without settlement;
- silently fall back to another coding agent, AI provider, model, endpoint, or auth mode.
