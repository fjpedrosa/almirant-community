# Pi runtime admission matrix v1

Pi 0.84.2 has one admitted production tuple: `pi/zai/glm-5.3/api_key`. Every other Pi tuple, auth class, or optional capability fails closed before credential export.

Related documents:

- [Pi operator runbook](../operations/pi-coding-agent.md)
- [Pi release evidence](./pi-release-evidence-v1.md)

## Sole admitted row

| Infrastructure `provider` | Coding agent | AI provider | Model | Auth | Product reasoning | Optional capabilities | Admission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zipu` | `pi` | `zai` | `glm-5.3` | `api_key` | Unset, `high`, or `max` | None | Enabled, subject to the live operator switch |

`provider=zipu` is the infrastructure routing lane. `aiProvider=zai` is the AI API identity. They are separate persisted fields: neither may be inferred from or overwrite the other. Values are exact and case-sensitive.

## Connection and credential decision

| Field | Required decision |
| --- | --- |
| Credential entry | **Settings → Integrations** only |
| Provider | `zai` |
| Auth class | `api_key` |
| Endpoint | `https://api.z.ai/api/coding/paas/v4` exactly |
| Account identifier | Unset for API-key connections |
| Credential value | Exact key bytes; no account identifier, label, or prefix |
| Bundle cardinality | Exactly one typed `zai/api_key` bundle |
| Claim fence | Current `jobId` + `workerId` + `claimAttemptId` |

Admission and the live claim fence run before provider lookup, decryption, refresh, or export. Pi does not consume flat legacy provider-key fields. The runner exports the admitted credential as `ZAI_API_KEY` only inside the job container and pins `PI_PROVIDER=zai` plus `PI_MODEL=glm-5.3`. Operators must not export the key in a shell or deployment environment.

Job input and connection metadata cannot replace runtime controls, the endpoint, the executable, or workspace ownership.

## Disabled rows

| Dimension | Disabled request | Rejection |
| --- | --- | --- |
| Coding agent/provider/model | Any Pi row other than exact `zai/glm-5.3` | Typed unsupported dimension or `RUNTIME_ADMISSION_DISABLED` |
| Auth | `setup_token` | `PI_AUTH_SETUP_TOKEN_DISABLED` |
| Auth | `provider_oauth` | `PI_AUTH_PROVIDER_OAUTH_DISABLED` |
| Auth | `subscription`, including OpenAI subscription access | `PI_AUTH_SUBSCRIPTION_DISABLED` |
| Capability | MCP (`mcp`) | `PI_CAPABILITY_MCP_DISABLED` |
| Capability | Browser (`browser`) | `PI_CAPABILITY_BROWSER_DISABLED` |
| Capability | Extensions/plugins (`extensions`) | `PI_CAPABILITY_EXTENSIONS_DISABLED` |
| Capability | Sandbox (`sandbox`) | `PI_CAPABILITY_SANDBOX_DISABLED` |
| Capability | Permission enforcement (`permission_enforced`) | `PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED` |
| Capability | Read-only enforcement (`read_only_enforced`) | `PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED` |
| Custom provider | Free-form provider, endpoint, header, environment, or command profile | `PI_CUSTOM_PROVIDER_DISABLED` |
| Registry identity | Version or projection-hash mismatch | `RUNTIME_REGISTRY_VERSION_MISMATCH` or `RUNTIME_REGISTRY_HASH_MISMATCH` |
| Live operator control | `PI_CODING_AGENT_ADMISSION_ENABLED=false` | `PI_ADMISSION_DISABLED` |

No disabled row may fall back to another coding agent, AI provider, model, endpoint, auth class, or capability.

## Product surface matrix

| Surface/context | Current Pi state | Reason |
| --- | --- | --- |
| Work-item implementation and runner actions | Selectable | Shared selector offers only Z.AI and `glm-5.3` |
| Planning chat before session start | Selectable with an active Z.AI key | Provider-key identity and model are filtered to the admitted row |
| Active/completed planning session | Read-only | Existing selection is displayed, not changed |
| Scheduled agent without browser, plugin, or MCP selections | Selectable | No optional Pi capability requested |
| Scheduled-agent browser control | Disabled for Pi | `PI_CAPABILITY_BROWSER_DISABLED` |
| Scheduled-agent plugin/extension control | Disabled for Pi | `PI_CAPABILITY_EXTENSIONS_DISABLED` |
| Scheduled-agent MCP control | Disabled for Pi | `PI_CAPABILITY_MCP_DISABLED` |
| Project AI implementation default | Selectable | Exact admitted row is available |
| Project dev-flow `backlog-drain` | Selectable | Write-capable context |
| Project dev-flow `dod-remediation` | Selectable | Write-capable context |
| Project dev-flow `release-integration` | Selectable | Write-capable context |
| Loop create/edit | Visible, disabled | Loops require MCP |
| Project dev-flow card default | Visible, disabled | Requires read-only enforcement |
| Project dev-flow `dod-review` | Visible, disabled | Requires read-only enforcement |

Persisted unknown, future, legacy, null/default, and unsupported values are retained for display and omitted from unrelated updates. A retained value is not a newly admitted row.

## Runtime, terminal, and usage authority

| Boundary | Decision |
| --- | --- |
| Pi process | Version `0.84.2`, RPC mode, no session persistence |
| Configuration | New empty config directory per session |
| Project discovery | Context files, extensions, skills, prompt templates, and themes disabled |
| Network-dependent package behavior | Offline controls enabled; provider traffic still follows runner egress policy |
| Telemetry/version checks | Disabled |
| Isolation claim | Pi flags reduce ambient input; container and host policy provide isolation |
| Terminal authority | A valid native `agent_settled` starts final settlement and produces exactly one canonical terminal `session.idle` |
| Early process exit | Failure if no valid settlement was observed |
| Usage authority | Verified post-settlement session-stat delta first; otherwise deduplicated final-message usage; otherwise explicitly unavailable, never fabricated as zero |

Terminal finalization is idempotent. Duplicate settlement does not produce another terminal event or another usage record.

## Sanitization and identifier policy

Diagnostics are bounded, converted to JSON-safe data, and redacted before persistence or display. Operators use typed category, runtime code, and cause code; raw provider text, headers, URLs, environment data, and command text are not evidence.

Runtime identities may be opaque hashes only when their source is non-secret protocol identity or usage data. API keys, tokens, account identifiers, connection labels, and any prefix, suffix, or hash of credential material must never become persisted or emitted identifiers.

## Image gate

| Environment | Gate |
| --- | --- |
| Local development | `docker compose --profile shims build pi-shim` builds `almirant-pi-shim:0.84.2` for local smoke only |
| Community publication | `.github/workflows/publish-docker.yml` builds one X64 (`linux/amd64`) Pi image, runs credential-free and expected-auth-failure smokes, then pushes that same image to Docker Hub |
| Self-host production | `PI_SHIM_IMAGE=DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>` is required |

A local Docker `sha256:` image ID is not the Docker Hub manifest digest. Deployment remains prohibited until publication emits the digest. See [release evidence](./pi-release-evidence-v1.md).

## Live operator control

`PI_CODING_AGENT_ADMISSION_ENABLED=false` stops new Pi producers, claims, and credential export after the API restarts. It does not terminate active jobs or alter non-Pi runtimes.

Authenticated discovery is available at `GET /api/runtime-capabilities`:

| Surface | Disabled value | Enabled value |
| --- | --- | --- |
| Header `X-Almirant-Pi-Admission` | `disabled; code=PI_ADMISSION_DISABLED` | `enabled; code=PI_ADMISSION_ENABLED` |
| `runtimeControls.piCodingAgentAdmission.enabled` | `false` | `true` |
| `runtimeControls.piCodingAgentAdmission.code` | `PI_ADMISSION_DISABLED` | `PI_ADMISSION_ENABLED` |

Rollback sets admission false, drains the runner while active work settles, and cancels queued Pi jobs individually through workspace-authenticated `POST /api/agent-jobs/:id/cancel`. It preserves active jobs, migrations, enum values, and evidence; direct SQL cancellation is not allowed.

## Migration state

| Migration | Expand-only semantics | Downgrade decision |
| --- | --- | --- |
| `0232_oval_marvex.sql` | Adds enum value `pi` and nullable `agent_jobs.resolved_runtime_selection`; no existing-row rewrite | Non-downgradable; retain enum and column |
| `0233_simple_terror.sql` | Adds nullable runtime/usage evidence, observed native-event AI provider/model, usage idempotency/cost fields, and a unique idempotency index; no legacy-row rewrite | Non-downgradable; retain schema and evidence |
