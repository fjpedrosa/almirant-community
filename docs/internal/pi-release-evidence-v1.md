# Pi release evidence v1

This document separates the evidence required for each Community image publication from the already-recorded valid Z.AI runtime evidence. It does not claim that a local image, a credential-free CI smoke, or an expected authentication failure proves valid account access.

Related documents:

- [Pi operator runbook](../operations/pi-coding-agent.md)
- [Pi runtime admission matrix](./pi-runtime-admission-matrix-v1.md)

## Release decision

| Boundary | Required decision |
| --- | --- |
| Admitted runtime | `pi/zai/glm-5.3/api_key` only |
| Optional capabilities | None |
| OpenAI subscription access | Disabled |
| Publication workflow | `.github/workflows/publish-docker.yml` |
| Publication architecture | X64 (`linux/amd64`) |
| Registry | Docker Hub |
| Deployable image | `DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>` |
| Database migrations | `0232_oval_marvex.sql` and `0233_simple_terror.sql` |

A local Docker image ID is not a registry manifest digest. Release approval requires the digest returned after the workflow pushes the exact image that passed both CI smoke gates.

## Evidence classes

| Evidence class | Credential behavior | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Credential-free CI smoke | Uses no valid provider credential and has network disabled | Image startup, liveness/readiness, exact `zai/glm-5.3` selection, session lifecycle, cleanup, and no real credential use | Valid Z.AI authentication or provider completion |
| Expected-auth-failure CI smoke | Uses a deterministic invalid value from a private temporary env file | The bounded authentication-failure path, one terminal outcome, cleanup, and credential redaction | Valid Z.AI authentication or successful inference |
| Already-recorded valid Z.AI evidence | Used a valid credential under controlled evidence handling | Real provider selection, response events, tool lifecycle, usage, terminal behavior, and cleanup for the admitted tuple | That a newly published Community digest is identical or has passed a fresh valid-credential run |

The first two rows are mandatory publication gates in `publish-docker.yml`. They are intentionally credential-free or expected to fail authentication. Do not describe either as a valid-credential smoke.

## Already-recorded valid Z.AI evidence

The existing valid-credential record for Pi 0.84.2 observed:

- exact core selection `pi/zai/glm-5.3`;
- `182` events and `14` canonical text events;
- exactly one `Read` tool-call start and one matching result;
- one normal terminal settlement, reported usage, and zero session errors;
- both canonical and compatibility idle representations.

Pi reported reasoning value `medium` in that run. The original checker incorrectly accepted only `high` and `max`; after its allowlist was corrected to match Pi's documented values, the checker suite passed `37/37`. No post-fix valid-credential rerun was recorded, so the evidence remains triangulated rather than represented as a fresh clean rerun. Product admission is narrower: user-selectable reasoning remains unset, `high`, or `max`.

This prior record qualifies the runtime behavior of the pinned integration. It does not replace the per-publication X64 smokes or the requirement to capture the new Docker Hub manifest digest.

## CI publication evidence

For the `almirant-pi-shim` matrix row, `publish-docker.yml` must:

1. build and load exactly one `linux/amd64` image;
2. run the credential-free smoke;
3. run the deterministic expected-auth-failure smoke;
4. stop before tag mutation if either smoke fails;
5. push that same local image to Docker Hub;
6. verify every published tag resolves to one `sha256:` digest;
7. attest the published digest.

Capture this release evidence without copying raw workflow logs:

| Evidence | Required value |
| --- | --- |
| Source revision | Exact release commit SHA |
| Workflow run | URL or immutable run identifier for `publish-docker.yml` |
| Credential-free smoke | Pass |
| Expected-auth-failure smoke | Pass |
| Published manifest | `DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>` |
| Attestation | Subject name and digest match the published manifest |
| Compose configuration | `PI_SHIM_IMAGE` equals the published manifest exactly |

Publication has not occurred merely because this document exists. Until a workflow run supplies the digest, the deployable manifest remains unavailable.

## Security evidence handling

Release evidence may contain bounded counts, typed failure categories/codes, source commit identities, workflow identifiers, and image digests. It must never contain:

- API keys, tokens, credential files, request headers, or environment dumps;
- raw provider responses, raw runtime diagnostics, URLs copied from failures, or stack traces that may carry sensitive data;
- key prefixes, suffixes, labels, account identifiers, hashes of credential material, or any other secret-derived identifier;
- unsanitized tool arguments or command text.

Runtime diagnostics must pass the bounded sanitizer before persistence or display. Persisted and emitted runtime identities must come only from non-secret protocol identity or usage fields; credential bytes and connection metadata are never identifier inputs. API-key `accountIdentifier` remains unset.

## Migration evidence

| Migration | Expand-only behavior | Rollback implication |
| --- | --- | --- |
| `0232_oval_marvex.sql` | Adds `pi` to `coding_agent` and the nullable `agent_jobs.resolved_runtime_selection` column; it does not rewrite existing rows | Retain the enum value and column; disable Pi in the application |
| `0233_simple_terror.sql` | Adds nullable runtime/usage evidence, observed native-event AI provider/model, usage idempotency/cost fields, and the unique idempotency index; it does not rewrite legacy rows | Retain columns, index, and evidence |

Both migrations are non-downgradable in the release procedure. Rollback sets admission false, drains the runner while active jobs settle, cancels queued Pi jobs through authenticated API routes, and preserves migrations and evidence. It never kills active jobs or updates job state with direct SQL.

## Release checklist

- [ ] The only enabled tuple is `pi/zai/glm-5.3/api_key`, with no optional capabilities.
- [ ] OpenAI subscription access remains disabled for Pi.
- [ ] Migrations `0232` and `0233` are applied and retained.
- [ ] The X64 publication run passed both distinct CI smoke modes.
- [ ] The Docker Hub manifest digest was captured from the push output.
- [ ] Self-host Compose uses that exact immutable value for `PI_SHIM_IMAGE`.
- [ ] Evidence contains no secrets, raw diagnostics, or secret-derived identifiers.
- [ ] Rollback readiness covers admission false, drain, queued-job cancellation, and active-job preservation.
