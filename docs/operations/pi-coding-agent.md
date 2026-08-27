# Operate Pi Coding Agent 0.84.2

Pi is admitted for one production runtime tuple: `pi/zai/glm-5.3/api_key`. This runbook covers credential setup, image publication, self-host rollout, diagnosis, admission control, and rollback without exposing credentials or terminating active jobs.

Related documents:

- [Pi runtime admission matrix](../internal/pi-runtime-admission-matrix-v1.md)
- [Pi release evidence](../internal/pi-release-evidence-v1.md)
- [Self-host environment reference](../self-hosting/environment.md#pi-runtime-controls-and-image)
- [Self-host getting started](../self-hosting/getting-started.md#pi-production-prerequisite)

## Quick path

1. Add the Z.AI API key in **Settings → Integrations**. Never place it in an environment file or shell command.
2. Set `PI_CODING_AGENT_ADMISSION_ENABLED=false` and restart the API before rollout.
3. Apply Community migrations `0232` and `0233`.
4. Publish through `.github/workflows/publish-docker.yml`; its X64 Pi job must pass the credential-free and expected-auth-failure smokes before push.
5. Set self-host `PI_SHIM_IMAGE` to `DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>`.
6. Restart the self-host stack, verify runtime controls, and run a controlled canary.
7. Set admission to `true` only after the canary passes.

## Supported contract

| Field | Required value |
| --- | --- |
| Pi version | `0.84.2` |
| Infrastructure `provider` lane | `zipu` |
| Coding agent | `pi` |
| AI provider | `zai` |
| Model | `glm-5.3` exactly |
| Authentication | `api_key` |
| Connection endpoint | `https://api.z.ai/api/coding/paas/v4` exactly |
| Product reasoning | Unset, `high`, or `max` |
| Optional Pi capabilities | None |

`provider=zipu` selects the infrastructure routing lane. `aiProvider=zai` selects the AI API. They are separate fields and must not be derived from each other.

MCP, browser, extensions, sandbox claims, permission enforcement, read-only enforcement, custom providers, setup tokens, provider OAuth, subscriptions, and OpenAI subscription access remain disabled for Pi. See the complete [rejection table](../internal/pi-runtime-admission-matrix-v1.md#disabled-rows).

## Configure the Z.AI connection

### Decision

The API key enters Almirant only through **Settings → Integrations**. API-key connections store no `accountIdentifier`, and the key is used byte-for-byte. Do not prepend an account name, key label, account identifier, or other prefix.

| Setting | Value |
| --- | --- |
| Provider | Z.AI |
| Auth method | API key |
| Plan/endpoint | Coding Plan at `https://api.z.ai/api/coding/paas/v4` |
| Pi model | `glm-5.3` |

There is deliberately no operator command for exporting `ZAI_API_KEY`. After admission, the runner exports it inside the single Pi job container and removes it at cleanup.

### UI steps

1. Open **Settings → Integrations** for the target workspace.
2. Add or edit the Z.AI integration.
3. Choose API-key authentication and the Coding Plan endpoint.
4. Paste the unmodified key into the secret field.
5. Save and validate the integration.

Never put the key in Compose files, deployment variables, job input, logs, URLs, tickets, or release evidence.

## User selection surfaces

The UI derives new choices from the generated capability projection. Existing unknown, historical, or unsupported values remain visible as retained data and are not rewritten by unrelated edits.

| Surface | Pi behavior |
| --- | --- |
| Work-item implementation and runner actions | Selectable; only Z.AI and `glm-5.3` are offered |
| Planning chat model selector | Selectable before session start with an active Z.AI integration; active or completed sessions are read-only |
| Scheduled-agent create/edit | Selectable only when browser is off and no plugin/extension or MCP server is selected |
| Project AI configuration | Selectable as the implementation default |
| Project dev-flow rows | Selectable for `backlog-drain`, `dod-remediation`, and `release-integration` |
| Loop create/edit | Visible but disabled because loops require MCP |
| Read-only dev-flow surfaces | Visible but disabled because Pi has no read-only enforcement capability |

Backend admission rejects crafted requests for disabled combinations before credential lookup. The operator switch is server-side control; a UI may still display Pi while the server rejects new production with `PI_ADMISSION_DISABLED`.

## Runtime and credential boundary

Each credential request is bound to the active `jobId`, `workerId`, and `claimAttemptId`. The API checks all three before provider lookup, decryption, refresh, or mutation.

For an admitted claim:

1. The API returns exactly one typed bundle for `provider=zai` and `authClass=api_key`.
2. The runner accepts no flat legacy provider-key fallback for Pi.
3. The runner constructs a sterile environment and exports the key only as `ZAI_API_KEY` inside the Pi container.
4. The runner pins `PI_PROVIDER=zai`, `PI_MODEL=glm-5.3`, and the canonical endpoint.
5. Each session gets a new empty Pi config directory. Session persistence and project-discovered context, extensions, skills, prompt templates, and themes are disabled.
6. Job input cannot replace controls, credentials, endpoint, proxy, executable, loader, TLS settings, or workspace ownership.

These controls reduce ambient input. Pi does not supply the container or host security boundary and does not provide permission or read-only enforcement.

## Terminal and usage authority

A native `agent_settled` event starts final settlement. The adapter then reads post-settlement session statistics and emits exactly one canonical terminal `session.idle`. Process exit without valid settlement is a failure; duplicate settlement is idempotent.

Usage follows this authority order:

1. verified post-settlement session-stat delta;
2. deduplicated final-message usage when the aggregate is unavailable;
3. explicitly unavailable when neither source is trustworthy.

Never infer missing usage as zero and never sum streaming snapshots.

## Sanitized evidence and identifiers

Diagnose with the bounded `runtime-failure-v1` category, code, and cause code. Do not persist or copy raw provider text, response bodies, URLs, headers, stack traces, environment data, tool arguments, or command text.

Credentials and connection metadata are not identity sources. Never derive a persisted or emitted identifier from a key, token, account identifier, connection label, credential prefix/suffix, or a hash of credential material. Opaque runtime identities may use only non-secret protocol identity or usage fields.

## Publish and pin the image

### Publication authority

Docker Hub publication is owned by `.github/workflows/publish-docker.yml`. For `almirant-pi-shim`, the X64 (`linux/amd64`) workflow:

1. builds and loads one local Pi image;
2. runs the credential-free lifecycle smoke;
3. runs the deterministic expected-auth-failure smoke;
4. stops before any push if either gate fails;
5. pushes that same image to `DOCKERHUB_USERNAME/almirant-pi-shim`;
6. verifies all tags resolve to one immutable digest and attests it.

Neither CI smoke has a valid account credential. The already-recorded valid Z.AI evidence is a separate evidence class described in [release evidence](../internal/pi-release-evidence-v1.md#already-recorded-valid-zai-evidence).

The deployable reference is exactly:

```text
DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>
```

Replace `DOCKERHUB_USERNAME` and `<digest>` with the values from the successful publication. Do not use a tag or a local image ID.

### Local build and credential-free smoke

Run from the repository root for development only:

```bash
docker compose --profile shims build pi-shim
bash services/runner/scripts/pi-image-smoke.sh \
  --image almirant-pi-shim:0.84.2
```

The smoke must report credential-free mode. Do not pass a real key. This local result does not create or approve a deployable registry manifest.

### Check the self-host reference

```bash
case "$PI_SHIM_IMAGE" in
  */almirant-pi-shim@sha256:*) ;;
  *) printf '%s\n' 'PI_SHIM_IMAGE must be a Docker Hub almirant-pi-shim digest' >&2; exit 1 ;;
esac

docker pull "$PI_SHIM_IMAGE"
docker image inspect "$PI_SHIM_IMAGE" --format '{{json .RepoDigests}}'
```

The inspected repository digest must match the value captured from `publish-docker.yml`.

## Rollout

| Order | Action | Gate to continue |
| ---: | --- | --- |
| 1 | Set `PI_CODING_AGENT_ADMISSION_ENABLED=false` and restart the API | Runtime-controls discovery reports disabled |
| 2 | Apply migrations `0232` and `0233` | Both migration ledger entries are present |
| 3 | Complete the X64 Docker Hub publication | Both CI smokes pass and a manifest digest exists |
| 4 | Set self-host `PI_SHIM_IMAGE` to that digest and restart the stack | Runner reports the intended image identity |
| 5 | Run a controlled canary | Exact tuple, one normal terminal, usage status, and cleanup pass |
| 6 | Set admission to `true` and restart the API | Runtime-controls discovery reports enabled |

The setting defaults to `true` for compatibility, so rollout and rollback must set it explicitly.

### Verify runtime controls

Use a curl config supplied by authenticated operator tooling. Keep it outside the repository with restrictive permissions.

```bash
curl --fail-with-body -i \
  --config "$ALMIRANT_CURL_AUTH_CONFIG" \
  "$ALMIRANT_API_ORIGIN/api/runtime-capabilities"
```

Expected disabled header:

```text
X-Almirant-Pi-Admission: disabled; code=PI_ADMISSION_DISABLED
```

The JSON response must also report `runtimeControls.piCodingAgentAdmission.enabled` as `false` with code `PI_ADMISSION_DISABLED`.

## Admission switch

Set `PI_CODING_AGENT_ADMISSION_ENABLED=false` and restart the API.

| Boundary | Effect after restart |
| --- | --- |
| Direct, scheduled, loop, planning, and project producers | New Pi production is rejected |
| Worker claim | Pi jobs are not newly claimed |
| Provider credential endpoint | Pi credential lookup/export is rejected |
| Active Pi process | Continues to normal completion while drain prevents replacement work |
| Queued Pi jobs | Remain queued until individually cancelled through the authenticated API |
| Persisted rows and migrations | Retained |
| Non-Pi runtimes | Unchanged |

The switch does not terminate active jobs, remove Pi enum values, reverse migrations, or delete queued jobs.

## Rollback

### Required sequence

1. Set `PI_CODING_AGENT_ADMISSION_ENABLED=false` and restart the API.
2. Drain the runner through its authenticated `/drain` endpoint; monitor until active work settles naturally.
3. Cancel each queued Pi job individually through the workspace-authenticated cancellation route.
4. Preserve migrations `0232` and `0233`, persisted enum values, runtime evidence, and release evidence.
5. Diagnose only from typed, sanitized failures. Do not update job state with direct SQL.

Do not kill or cancel active Pi jobs during rollback. Drain stops new work and allows active jobs to finish; the cancellation step applies only to jobs confirmed queued.

### Drain the runner

The curl config must supply the server-owned runner credential without putting it in command history.

```bash
curl --fail-with-body -X POST \
  --config "$RUNNER_CONTROL_CURL_CONFIG" \
  "$RUNNER_ORIGIN/drain"
```

Expected response is `drain initiated` or `already draining`.

### Cancel one queued Pi job

Repeat only for job IDs confirmed to be queued Pi jobs. The curl config must carry workspace-authenticated user credentials.

```bash
curl --fail-with-body -X POST \
  --config "$ALMIRANT_CURL_AUTH_CONFIG" \
  "$ALMIRANT_API_ORIGIN/api/agent-jobs/$JOB_ID/cancel"
```

Individual API cancellation preserves workspace authorization, job transitions, and audit behavior. Do not use a bulk SQL update.

## Migration behavior

| Migration | Expand-only change | Rollback rule |
| --- | --- | --- |
| `0232_oval_marvex.sql` | Adds `pi` to `coding_agent`; adds nullable `agent_jobs.resolved_runtime_selection` JSONB | Never remove the enum value or rewrite old rows |
| `0233_simple_terror.sql` | Adds nullable runtime evidence to jobs and usage, observed AI provider/model to native events, usage idempotency/cost fields, and the unique idempotency index | Retain all columns, index, and evidence |

Application rollback uses admission control, drain, and queued-job cancellation. It does not reverse these migrations.

## Troubleshooting by typed failure

| Category | Runtime code | Common Pi cause codes | Operator action |
| --- | --- | --- | --- |
| `auth` | `RUNTIME_AUTH_FAILURE` | `PI_RPC_AUTH_ERROR`, disabled auth-policy codes | Confirm an active Z.AI API-key integration, exact unprefixed key storage, canonical endpoint, and enabled admission. Replace the connection through Settings if needed. |
| `model` | `RUNTIME_MODEL_FAILURE` | `RUNTIME_MODEL_UNSUPPORTED`, `PI_RPC_STATE_MISMATCH`, `PI_RPC_MODEL_ERROR` | Confirm `pi/zai/glm-5.3/api_key` exactly and reasoning unset, `high`, or `max`. Never normalize or fall back. |
| `endpoint` | `RUNTIME_ENDPOINT_FAILURE` | `RUNTIME_AI_PROVIDER_UNSUPPORTED`, `PI_RPC_ENDPOINT_ERROR` | Confirm the canonical Coding Plan endpoint and runner egress. Reject redirects, alternate hosts, custom ports, query strings, and overrides. |
| `protocol` | `RUNTIME_PROTOCOL_FAILURE` | `PI_RPC_PROTOCOL_ERROR` | Compare Pi version and image digest. Keep only the bounded typed diagnostic and stop admission if framing, correlation, or terminal rules differ. |
| `process` | `RUNTIME_PROCESS_FAILURE` | `PI_RPC_PROCESS_EXIT`, `PI_RPC_PROCESS_SIGNAL`, `PI_RPC_STDIN_ERROR`, `PI_RPC_TIMEOUT`, `PI_RPC_COMMAND_FAILED`, reap failures | Inspect safe runner diagnostics and image identity. Drain for reap failures. Only the typed timeout mapping is retryable by default. |
| `cancellation` | `RUNTIME_CANCELLED` | `PI_RPC_CANCELLED` | Confirm a queued-job cancellation was requested and exactly one terminal outcome was recorded. |
| `usage` | `RUNTIME_USAGE_INTEGRITY_FAILURE` | `PI_RPC_USAGE_INTEGRITY_ERROR` | Treat usage as unavailable, never zero. Preserve sanitized evidence and investigate duplicate terminal or aggregate mismatch. |
| `policy` | `RUNTIME_POLICY_FAILURE` | `PI_ADMISSION_DISABLED`, registry mismatch, capability codes, `PI_CUSTOM_PROVIDER_DISABLED`, `PI_RPC_CONFIG_ERROR` | Read the cause code and runtime controls. Correct the selection or rollout state; never bypass policy or export a credential manually. |

If a failure is not covered, keep admission false, drain the runner, retain only the bounded failure envelope, and compare it with the [release evidence](../internal/pi-release-evidence-v1.md).
