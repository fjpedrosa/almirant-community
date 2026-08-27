#!/usr/bin/env bash

set -euo pipefail
set +x
umask 077

IMAGE=""
CREDENTIAL_ENV_FILE=""
REQUESTED_ENV_NAME=""
CREDENTIAL_FILE_ACCEPTED=0
CREDENTIAL_MODE=0
EXPECT_AUTH_FAILURE=0
NETWORK_MODE=none
CONTAINER_STARTED=0
CONTAINER_STOPPED=0
CONTAINER_NAME=""
SSE_PID=""
TEMP_ROOT=""
unset ALMIRANT_PI_SMOKE_POINT_OPERATION

fail() {
  printf 'pi image smoke: %s\n' "$1" >&2
  exit 1
}

stop_sse_capture() {
  if [[ -n "$SSE_PID" ]] && kill -0 "$SSE_PID" 2>/dev/null; then
    kill "$SSE_PID" 2>/dev/null || true
    wait "$SSE_PID" 2>/dev/null || true
  fi
  SSE_PID=""
}

bounded_docker() {
  python3 -c '
import os
import signal
import subprocess
import sys

TIMEOUT_SECONDS = 15
KILL_AFTER_SECONDS = 2


class ForwardedSignal(Exception):
    def __init__(self, signum):
        self.signum = signum


child_env = os.environ.copy()
child_env["ALMIRANT_PI_SMOKE_POINT_OPERATION"] = "1"
process = subprocess.Popen(
    ["docker", *sys.argv[1:]],
    env=child_env,
    start_new_session=True,
)
handled_signals = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)


def handle_signal(signum, _frame):
    raise ForwardedSignal(signum)


def stop_process_group(first_signal):
    for handled_signal in handled_signals:
        signal.signal(handled_signal, signal.SIG_IGN)
    try:
        os.killpg(process.pid, first_signal)
    except ProcessLookupError:
        return process.wait()
    try:
        return process.wait(timeout=KILL_AFTER_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return process.wait()


for handled_signal in handled_signals:
    signal.signal(handled_signal, handle_signal)

try:
    return_code = process.wait(timeout=TIMEOUT_SECONDS)
except subprocess.TimeoutExpired:
    stop_process_group(signal.SIGTERM)
    raise SystemExit(124)
except ForwardedSignal as received_signal:
    stop_process_group(received_signal.signum)
    raise SystemExit(128 + received_signal.signum)

raise SystemExit(return_code if return_code >= 0 else 128 - return_code)
' "$@"
}

cleanup() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  set +e

  stop_sse_capture
  if [[ "$CONTAINER_STARTED" -eq 1 && "$CONTAINER_STOPPED" -eq 0 && -n "$CONTAINER_NAME" ]]; then
    bounded_docker stop --time 8 "$CONTAINER_NAME" >/dev/null 2>&1
  fi
  if [[ "$CONTAINER_STARTED" -eq 1 && -n "$CONTAINER_NAME" ]]; then
    bounded_docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1
  fi
  if [[ "$CREDENTIAL_FILE_ACCEPTED" -eq 1 && -n "$CREDENTIAL_ENV_FILE" ]]; then
    rm -f -- "$CREDENTIAL_ENV_FILE"
  fi
  if [[ -n "$TEMP_ROOT" && -d "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi

  unset ZAI_API_KEY CREDENTIAL_ENV_FILE REQUESTED_ENV_NAME
  unset ALMIRANT_PI_SMOKE_POINT_OPERATION
  exit "$exit_code"
}

signal_exit() {
  exit 130
}

trap signal_exit HUP INT TERM
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      [[ $# -ge 2 ]] || fail "--image requires a value"
      [[ -z "$IMAGE" ]] || fail "--image may be supplied only once"
      IMAGE=$2
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail "--env-file requires a value"
      [[ -z "$CREDENTIAL_ENV_FILE" ]] || fail "--env-file may be supplied only once"
      CREDENTIAL_ENV_FILE=$2
      shift 2
      ;;
    --env)
      [[ $# -ge 2 ]] || fail "--env requires a name"
      [[ -z "$REQUESTED_ENV_NAME" ]] || fail "--env may be supplied only once"
      REQUESTED_ENV_NAME=$2
      shift 2
      ;;
    --expect-auth-failure)
      [[ "$EXPECT_AUTH_FAILURE" -eq 0 ]] || fail "--expect-auth-failure may be supplied only once"
      EXPECT_AUTH_FAILURE=1
      shift
      ;;
    --help)
      printf 'Usage: pi-image-smoke.sh --image IMAGE [--env-file /tmp/almirant-pi-smoke[.SUFFIX].env --env ZAI_API_KEY [--expect-auth-failure]]\n'
      exit 0
      ;;
    *)
      fail "unsupported argument"
      ;;
  esac
done

[[ -n "$IMAGE" ]] || fail "--image is required"
[[ "$IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,254}$ ]] || fail "--image is not a bounded Docker image reference"
if [[ "$EXPECT_AUTH_FAILURE" -eq 1 ]]; then
  [[ -n "$CREDENTIAL_ENV_FILE" && -n "$REQUESTED_ENV_NAME" ]] || fail "--expect-auth-failure requires --env-file and --env ZAI_API_KEY"
fi

if [[ -n "$CREDENTIAL_ENV_FILE" || -n "$REQUESTED_ENV_NAME" ]]; then
  [[ -n "$CREDENTIAL_ENV_FILE" && -n "$REQUESTED_ENV_NAME" ]] || fail "credentialed mode requires both --env-file and --env"
  [[ "$REQUESTED_ENV_NAME" == "ZAI_API_KEY" ]] || fail "credentialed mode accepts only the ZAI_API_KEY environment name"

  case "$CREDENTIAL_ENV_FILE" in
    /tmp/almirant-pi-smoke.env)
      ;;
    /tmp/almirant-pi-smoke.*.env)
      credential_suffix=${CREDENTIAL_ENV_FILE#/tmp/almirant-pi-smoke.}
      credential_suffix=${credential_suffix%.env}
      [[ ${#credential_suffix} -ge 1 && ${#credential_suffix} -le 32 ]] || fail "credential env-file suffix is invalid"
      [[ "$credential_suffix" =~ ^[A-Za-z0-9_-]+$ ]] || fail "credential env-file suffix is invalid"
      unset credential_suffix
      ;;
    *)
      fail "credentialed mode accepts only a private /tmp/almirant-pi-smoke env file"
      ;;
  esac

  [[ -f "$CREDENTIAL_ENV_FILE" && ! -L "$CREDENTIAL_ENV_FILE" ]] || fail "credential env file must be a regular non-symlink file"
  credential_mode_bits=$(stat -c '%a' "$CREDENTIAL_ENV_FILE" 2>/dev/null || stat -f '%Lp' "$CREDENTIAL_ENV_FILE" 2>/dev/null || true)
  [[ "$credential_mode_bits" == "600" ]] || fail "credential env file must have mode 0600"
  unset credential_mode_bits

  credential_line=""
  credential_line_count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    credential_line_count=$((credential_line_count + 1))
    [[ "$credential_line_count" -eq 1 ]] || fail "credential env file must contain exactly one assignment"
    credential_line=$line
  done < "$CREDENTIAL_ENV_FILE"
  [[ "$credential_line_count" -eq 1 && "$credential_line" == ZAI_API_KEY=* ]] || fail "credential env file must contain only ZAI_API_KEY"
  credential_value=${credential_line#ZAI_API_KEY=}
  [[ -n "$credential_value" && ! "$credential_value" =~ [[:space:]] ]] || fail "credential env file contains an invalid key"
  export ZAI_API_KEY="$credential_value"
  unset credential_line credential_line_count credential_value line
  CREDENTIAL_FILE_ACCEPTED=1
  CREDENTIAL_MODE=1
  NETWORK_MODE=bridge
else
  export ZAI_API_KEY='ALMIRANT_PI_SMOKE_FAKE_KEY_SENTINEL_NOT_A_CREDENTIAL_7F31C2'
fi

for required_command in docker jq python3 od sed tail awk chmod grep mktemp tr; do
  command -v "$required_command" >/dev/null 2>&1 || fail "a required local command is unavailable"
done

TEMP_ROOT=$(mktemp -d /tmp/almirant-pi-image-smoke.XXXXXX)
chmod 700 "$TEMP_ROOT"

RUN_LOG="$TEMP_ROOT/run.log"
INSPECT_LOG="$TEMP_ROOT/inspect.log"
EXEC_LOG="$TEMP_ROOT/exec.log"
HTTP_RAW_LOG="$TEMP_ROOT/http-raw.log"
HTTP_BODY_LOG="$TEMP_ROOT/http-body.log"
SSE_LOG="$TEMP_ROOT/events.sse.log"
SSE_ERROR_LOG="$TEMP_ROOT/events.stderr.log"
SSE_JSONL_LOG="$TEMP_ROOT/events.jsonl.log"
STOP_LOG="$TEMP_ROOT/stop.log"
CONTAINER_LOG="$TEMP_ROOT/container.log"
for private_log in \
  "$RUN_LOG" "$INSPECT_LOG" "$EXEC_LOG" "$HTTP_RAW_LOG" \
  "$HTTP_BODY_LOG" "$SSE_LOG" "$SSE_ERROR_LOG" "$SSE_JSONL_LOG" \
  "$STOP_LOG" "$CONTAINER_LOG"; do
  : > "$private_log"
  chmod 600 "$private_log"
done

random_suffix=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
[[ "$random_suffix" =~ ^[0-9a-f]{12}$ ]] || fail "could not generate a bounded random container name"
CONTAINER_NAME="almirant-pi-smoke-$random_suffix"
unset random_suffix
[[ ${#CONTAINER_NAME} -le 63 ]] || fail "generated container name is too long"

if ! bounded_docker run --detach \
  --name "$CONTAINER_NAME" \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --network "$NETWORK_MODE" \
  --pids-limit 128 \
  --memory 1g \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777,uid=1000,gid=1000 \
  --tmpfs /workspace/repo:rw,noexec,nosuid,nodev,size=16m,mode=0700,uid=1000,gid=1000 \
  --tmpfs /home/node:rw,noexec,nosuid,nodev,size=16m,mode=0700,uid=1000,gid=1000 \
  --env PI_PROVIDER=zai \
  --env PI_MODEL=glm-5.3 \
  --env ZAI_API_KEY \
  "$IMAGE" >"$RUN_LOG" 2>&1; then
  fail "container failed to start"
fi
CONTAINER_STARTED=1

if ! bounded_docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" >"$INSPECT_LOG" 2>&1; then
  fail "container state could not be inspected"
fi
[[ "$(tail -n 1 "$INSPECT_LOG")" == "true" ]] || fail "container is not running"

if ! bounded_docker exec "$CONTAINER_NAME" id -u >"$EXEC_LOG" 2>&1; then
  fail "container user could not be inspected"
fi
container_uid=$(tail -n 1 "$EXEC_LOG")
[[ "$container_uid" =~ ^[0-9]+$ && "$container_uid" -gt 0 ]] || fail "container must run with a numeric nonroot UID"
unset container_uid

HTTP_STATUS=""
http_request() {
  local method=$1
  local path=$2
  local data=${3-}
  local -a curl_args
  curl_args=(
    curl --silent --show-error --max-time 15
    --request "$method"
    --output -
    --write-out '\n%{http_code}'
  )
  if [[ -n "$data" ]]; then
    curl_args+=(--header 'content-type: application/json' --data "$data")
  fi
  curl_args+=("http://127.0.0.1:4096$path")

  : > "$HTTP_RAW_LOG"
  : > "$HTTP_BODY_LOG"
  if ! bounded_docker exec "$CONTAINER_NAME" "${curl_args[@]}" >"$HTTP_RAW_LOG" 2>&1; then
    return 1
  fi
  HTTP_STATUS=$(tail -n 1 "$HTTP_RAW_LOG")
  sed '$d' "$HTTP_RAW_LOG" > "$HTTP_BODY_LOG"
  [[ "$HTTP_STATUS" =~ ^[0-9]{3}$ ]]
}

wait_for_readiness() {
  local attempt
  for attempt in {1..60}; do
    if http_request GET /health/ready \
      && [[ "$HTTP_STATUS" == "200" ]] \
      && jq -e 'type == "object" and keys == ["ready"] and .ready == true' "$HTTP_BODY_LOG" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_readiness || fail "readiness did not become healthy"
http_request GET /health/live || fail "liveness request failed"
[[ "$HTTP_STATUS" == "200" ]] || fail "liveness returned an unexpected status"
jq -e 'type == "object" and keys == ["ok"] and .ok == true' "$HTTP_BODY_LOG" >/dev/null 2>&1 || fail "liveness returned an unexpected body"

http_request POST /session '{}' || fail "empty-body session creation failed"
[[ "$HTTP_STATUS" == "200" ]] || fail "empty-body session creation returned an unexpected status"
jq -e '
  type == "object" and
  (.id | type == "string" and length > 0) and
  .provider == "zai" and
  .model == "glm-5.3" and
  .status == "idle"
' "$HTTP_BODY_LOG" >/dev/null 2>&1 || fail "session did not resolve the exact provider and model"
SESSION_ID=$(jq -r '.id' "$HTTP_BODY_LOG")
[[ "$SESSION_ID" =~ ^[A-Za-z0-9._:-]+$ ]] || fail "session returned an unsafe identifier"

extract_sse_jsonl() {
  sed -n 's/^data: //p' "$SSE_LOG" > "$SSE_JSONL_LOG"
}

credential_material_in_file() {
  local path=$1
  LC_ALL=C awk '
    BEGIN {
      secret = ENVIRON["ZAI_API_KEY"]
      prefix = length(secret) >= 20 ? substr(secret, 1, 20) : secret
      suffix = length(secret) >= 20 ? substr(secret, length(secret) - 19, 20) : secret
      found = 0
    }
    secret != "" && index($0, secret) { found = 1 }
    prefix != "" && index($0, prefix) { found = 1 }
    suffix != "" && index($0, suffix) { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$path"
}

assert_no_credential_material_in_private_logs() {
  local private_log
  for private_log in "$TEMP_ROOT"/*; do
    [[ -f "$private_log" ]] || continue
    if credential_material_in_file "$private_log"; then
      return 1
    fi
  done
  return 0
}

assert_credentialed_events() {
  extract_sse_jsonl
  jq -s -e '
    def exact_observed_selection:
      if type != "object" then false
      else
        .codingAgent == "pi" and
        .aiProvider == "zai" and
        .model == "glm-5.3" and
        ((keys - ["codingAgent", "aiProvider", "model", "reasoningLevel"]) | length == 0) and
        (
          (has("reasoningLevel") | not) or
          (.reasoningLevel | (
            (type == "string") and
            (
              . == "off" or . == "minimal" or . == "low" or
              . == "medium" or . == "high" or . == "xhigh" or . == "max"
            )
          ))
        )
      end;
    ([.[] | select(.type == "agent.tool_call.start" and .properties.kind == "agent.tool_call.start")]) as $starts |
    ([.[] | select(.type == "agent.tool_call.result" and .properties.kind == "agent.tool_call.result")]) as $results |
    ([.[] | select(.type == "session.idle" and .properties.kind == "session.idle")]) as $idle |
    ([.[] | select(.type == "agent.text" and .properties.kind == "agent.text") ] | length >= 1) and
    ($starts | length == 1) and
    ($starts[0].properties.toolName == "Read") and
    ($starts[0].properties.toolCallId | type == "string" and test("^rti_sha256_[a-f0-9]{64}$")) and
    ($results | length == 1) and
    ($results[0].properties.success == true) and
    ($results[0].properties.toolCallId == $starts[0].properties.toolCallId) and
    ($idle | length == 1) and
    ($idle[0].properties.metadata.runtimeEvidence.observed | exact_observed_selection) and
    (
      ($idle[0].properties.metadata.runtimeEvidence.usage.status == "reported" and
       ($idle[0].properties.metadata.runtimeEvidence.usage.inputTokens | type) == "number" and
       ($idle[0].properties.metadata.runtimeEvidence.usage.outputTokens | type) == "number")
      or
      ($idle[0].properties.metadata.runtimeEvidence.usage.status == "unavailable" and
       ($idle[0].properties.metadata.runtimeEvidence.usage.reason | type) == "string")
    )
  ' "$SSE_JSONL_LOG" >/dev/null 2>&1
}

emit_credentialed_event_diagnostic() {
  local diagnostic
  if ! diagnostic=$(jq -s -r '
    def object_events: [.[] | select(type == "object")];
    def error_code_category:
      if . == "PI_RPC_AUTH_ERROR" then "auth"
      elif . == "PI_RPC_CONFIG_ERROR" or . == "PI_RPC_STATE_MISMATCH" then "config"
      elif . == "PI_RPC_MODEL_ERROR" then "model"
      elif . == "PI_RPC_ENDPOINT_ERROR" then "endpoint"
      elif . == "PI_RPC_PROTOCOL_ERROR" then "protocol"
      elif . == "PI_RPC_PROCESS_EXIT" or
           . == "PI_RPC_PROCESS_SIGNAL" or
           . == "PI_RPC_STDIN_ERROR" or
           . == "PI_RPC_TIMEOUT" or
           . == "PI_RPC_COMMAND_FAILED" or
           . == "PI_RPC_PROCESS_REAP_TIMEOUT" or
           . == "PI_PROCESS_GROUP_NOT_REAPED" then "process"
      elif . == "PI_RPC_CANCELLED" then "cancellation"
      elif . == "PI_RPC_USAGE_INTEGRITY_ERROR" then "usage"
      elif . == "PI_RPC_AGENT_ERROR" then "agent"
      elif . == "PI_RPC_RUNTIME_ERROR" then "runtime"
      else "other"
      end;
    def exact_observed_selection:
      if type != "object" then false
      else
        .codingAgent == "pi" and
        .aiProvider == "zai" and
        .model == "glm-5.3" and
        ((keys - ["codingAgent", "aiProvider", "model", "reasoningLevel"]) | length == 0) and
        (
          (has("reasoningLevel") | not) or
          (.reasoningLevel | (
            (type == "string") and
            (
              . == "off" or . == "minimal" or . == "low" or
              . == "medium" or . == "high" or . == "xhigh" or . == "max"
            )
          ))
        )
      end;
    . as $parsed |
    ($parsed | object_events) as $events |
    ([$events[] | select(.type == "agent.text" and (.properties | type) == "object" and .properties.kind == "agent.text")]) as $canonical_text |
    ([$events[] | select(.type == "agent.tool_call.start" and (.properties | type) == "object" and .properties.kind == "agent.tool_call.start")]) as $canonical_starts |
    ([$events[] | select(.type == "agent.tool_call.result" and (.properties | type) == "object" and .properties.kind == "agent.tool_call.result")]) as $canonical_results |
    ([$canonical_results[] | .properties.toolCallId as $result_id | select(($result_id | type) == "string" and any($canonical_starts[]; (.properties.toolCallId | type) == "string" and .properties.toolCallId == $result_id))]) as $matching_results |
    ([$events[] | select(.type == "session.idle" and (.properties | type) == "object" and .properties.kind == "session.idle")]) as $canonical_idle |
    ([$events[] | select(.type == "session.idle" and (((.properties | type) != "object") or .properties.kind != "session.idle"))]) as $legacy_idle |
    ([$events[] | select(.type == "session.error" and (.properties | type) == "object" and .properties.kind == "session.error")]) as $canonical_errors |
    ([$canonical_errors[] | (.properties.errorCode | error_code_category)]) as $error_categories |
    ([$canonical_starts[] | select(.properties.toolName == "Read")] | length) as $read_starts |
    ([$canonical_starts[] | select(.properties.toolName != "Read")] | length) as $other_name_starts |
    ([$canonical_results[] | select(.properties.success == true)] | length) as $successful_results |
    ([$canonical_idle[] | select(.properties.metadata.runtimeEvidence.observed | exact_observed_selection)] | length) as $exact_observed_selection |
    ([$canonical_idle[] | select(.properties.metadata.runtimeEvidence.usage.status == "reported")] | length) as $reported_usage |
    ([$canonical_idle[] | select(.properties.metadata.runtimeEvidence.usage.status == "unavailable")] | length) as $unavailable_usage |
    ([$canonical_idle[] | select(.properties.metadata.runtimeEvidence.usage.status != "reported" and .properties.metadata.runtimeEvidence.usage.status != "unavailable")] | length) as $other_usage |
    ([$error_categories[] | select(. == "auth")] | length) as $auth_errors |
    ([$error_categories[] | select(. == "config")] | length) as $config_errors |
    ([$error_categories[] | select(. == "model")] | length) as $model_errors |
    ([$error_categories[] | select(. == "endpoint")] | length) as $endpoint_errors |
    ([$error_categories[] | select(. == "protocol")] | length) as $protocol_errors |
    ([$error_categories[] | select(. == "process")] | length) as $process_errors |
    ([$error_categories[] | select(. == "cancellation")] | length) as $cancellation_errors |
    ([$error_categories[] | select(. == "usage")] | length) as $usage_errors |
    ([$error_categories[] | select(. == "agent")] | length) as $agent_errors |
    ([$error_categories[] | select(. == "runtime")] | length) as $runtime_errors |
    ([$error_categories[] | select(. == "other")] | length) as $other_errors |
    "pi image smoke credentialed diagnostic: events.total=\($parsed | length) " +
    "agent.text.canonical=\($canonical_text | length) " +
    "tool.start.canonical=\($canonical_starts | length) " +
    "tool.start.Read=\($read_starts) " +
    "tool.start.other_name=\($other_name_starts) " +
    "tool.result.canonical=\($canonical_results | length) " +
    "tool.result.success=\($successful_results) " +
    "tool.result.matching_start_id=\($matching_results | length) " +
    "session.idle.canonical=\($canonical_idle | length) " +
    "session.idle.legacy=\($legacy_idle | length) " +
    "observed.exact_selection=\($exact_observed_selection) " +
    "usage.reported=\($reported_usage) " +
    "usage.unavailable=\($unavailable_usage) " +
    "usage.other=\($other_usage) " +
    "session.error.canonical=\($canonical_errors | length) " +
    "session.error.code_category.auth=\($auth_errors) " +
    "session.error.code_category.config=\($config_errors) " +
    "session.error.code_category.model=\($model_errors) " +
    "session.error.code_category.endpoint=\($endpoint_errors) " +
    "session.error.code_category.protocol=\($protocol_errors) " +
    "session.error.code_category.process=\($process_errors) " +
    "session.error.code_category.cancellation=\($cancellation_errors) " +
    "session.error.code_category.usage=\($usage_errors) " +
    "session.error.code_category.agent=\($agent_errors) " +
    "session.error.code_category.runtime=\($runtime_errors) " +
    "session.error.code_category.other=\($other_errors)"
  ' "$SSE_JSONL_LOG" 2>/dev/null); then
    diagnostic='pi image smoke credentialed diagnostic: events.total=0 agent.text.canonical=0 tool.start.canonical=0 tool.start.Read=0 tool.start.other_name=0 tool.result.canonical=0 tool.result.success=0 tool.result.matching_start_id=0 session.idle.canonical=0 session.idle.legacy=0 observed.exact_selection=0 usage.reported=0 usage.unavailable=0 usage.other=0 session.error.canonical=0 session.error.code_category.auth=0 session.error.code_category.config=0 session.error.code_category.model=0 session.error.code_category.endpoint=0 session.error.code_category.protocol=0 session.error.code_category.process=0 session.error.code_category.cancellation=0 session.error.code_category.usage=0 session.error.code_category.agent=0 session.error.code_category.runtime=0 session.error.code_category.other=0'
  fi
  printf '%s\n' "$diagnostic" >&2
}

assert_auth_failure_events() {
  extract_sse_jsonl
  if credential_material_in_file "$SSE_LOG" || credential_material_in_file "$SSE_ERROR_LOG"; then
    return 1
  fi
  jq -s -e '
    ([.[] | select(.type == "session.error" and (.properties | type) == "object" and .properties.kind == "session.error")]) as $canonicalErrors |
    ([.[] | select(.type == "session.idle" and (.properties | type) == "object" and .properties.kind == "session.idle")]) as $canonicalIdle |
    ([.[] | select(.type == "session.idle" and (((.properties | type) != "object") or .properties.kind != "session.idle"))]) as $legacyIdle |
    ([.[] | select(.type == "agent.tool_call.result" and .properties.kind == "agent.tool_call.result" and .properties.success == true)]) as $successfulResults |
    ($canonicalErrors | length == 1) and
    ($canonicalErrors[0].properties.message == "Runtime authentication failed.") and
    ($canonicalErrors[0].properties.errorCode == "PI_RPC_AUTH_ERROR") and
    ($canonicalErrors[0].properties.errorCategory == "config") and
    ($canonicalErrors[0].properties.recoverable == false) and
    ($canonicalErrors[0].properties.runtimeFailure == {
      schemaVersion: "runtime-failure-v1",
      code: "RUNTIME_AUTH_FAILURE",
      category: "auth",
      retryable: false,
      message: "Runtime authentication failed.",
      causeCode: "PI_RPC_AUTH_ERROR"
    }) and
    ($canonicalIdle | length == 1) and
    ($legacyIdle | length == 1) and
    ($successfulResults | length == 0) and
    ([.. | objects | keys[] | ascii_downcase] | all(test("url|header|errormessage|privatemessage") | not)) and
    ([.. | strings] | all(test("https?://|authorization|bearer |x-api-key|http [0-9][0-9][0-9]"; "i") | not))
  ' "$SSE_JSONL_LOG" >/dev/null 2>&1
}

emit_auth_failure_event_diagnostic() {
  local diagnostic
  if ! diagnostic=$(jq -s -r '
    def object_events: [.[] | select(type == "object")];
    def allowed_categories: ["auth", "model", "endpoint", "protocol", "process", "cancellation", "usage", "policy"];
    def allowed_cause_codes: [
      "PI_RPC_AUTH_ERROR", "PI_RPC_CONFIG_ERROR", "PI_RPC_STATE_MISMATCH",
      "PI_RPC_MODEL_ERROR", "PI_RPC_ENDPOINT_ERROR", "PI_RPC_PROTOCOL_ERROR",
      "PI_RPC_PROCESS_EXIT", "PI_RPC_PROCESS_SIGNAL", "PI_RPC_STDIN_ERROR",
      "PI_RPC_TIMEOUT", "PI_RPC_CANCELLED", "PI_RPC_COMMAND_FAILED",
      "PI_RPC_PROCESS_REAP_TIMEOUT", "PI_PROCESS_GROUP_NOT_REAPED",
      "PI_RPC_USAGE_INTEGRITY_ERROR", "PI_RPC_AGENT_ERROR", "PI_RPC_RUNTIME_ERROR"
    ];
    . as $parsed |
    ($parsed | object_events) as $events |
    ([$events[] | select(.type == "session.error" and (.properties | type) == "object" and .properties.kind == "session.error")]) as $canonical_errors |
    ([$events[] | select(.type == "session.error" and (((.properties | type) != "object") or .properties.kind != "session.error"))]) as $legacy_errors |
    ([$events[] | select(.type == "session.idle" and (.properties | type) == "object" and .properties.kind == "session.idle")]) as $canonical_idle |
    ([$events[] | select(.type == "session.idle" and (((.properties | type) != "object") or .properties.kind != "session.idle"))]) as $legacy_idle |
    ([$events[] | select(.type == "agent.tool_call.result" and (.properties | type) == "object" and .properties.kind == "agent.tool_call.result" and .properties.success == true)]) as $successful_results |
    ([$canonical_errors[] | .properties.runtimeFailure | select(type == "object")]) as $runtime_failures |
    ([$canonical_errors[] | select(.properties.errorCode == "PI_RPC_AUTH_ERROR")] | length) as $auth_error_codes |
    ([$runtime_failures[] | .category as $category | select((allowed_categories | index($category)) == null)] | length) as $unknown_categories |
    ([$runtime_failures[] | .causeCode as $cause_code | select((allowed_cause_codes | index($cause_code)) != null)] | length) as $allowlisted_causes |
    ([$runtime_failures[] | .causeCode as $cause_code | select((allowed_cause_codes | index($cause_code)) == null)] | length) as $unknown_causes |
    ([$runtime_failures[] | select(.category == "auth")] | length) as $auth_categories |
    ([$runtime_failures[] | select(.category == "model")] | length) as $model_categories |
    ([$runtime_failures[] | select(.category == "endpoint")] | length) as $endpoint_categories |
    ([$runtime_failures[] | select(.category == "protocol")] | length) as $protocol_categories |
    ([$runtime_failures[] | select(.category == "process")] | length) as $process_categories |
    ([$runtime_failures[] | select(.category == "cancellation")] | length) as $cancellation_categories |
    ([$runtime_failures[] | select(.category == "usage")] | length) as $usage_categories |
    ([$runtime_failures[] | select(.category == "policy")] | length) as $policy_categories |
    "pi image smoke auth diagnostic: total=\($parsed | length) " +
    "session.error.canonical=\($canonical_errors | length) " +
    "session.error.legacy=\($legacy_errors | length) " +
    "PI_RPC_AUTH_ERROR=\($auth_error_codes) " +
    "session.idle.canonical=\($canonical_idle | length) " +
    "session.idle.legacy=\($legacy_idle | length) " +
    "successful_tool_result=\($successful_results | length) " +
    "runtimeFailure.category.auth=\($auth_categories) " +
    "runtimeFailure.category.model=\($model_categories) " +
    "runtimeFailure.category.endpoint=\($endpoint_categories) " +
    "runtimeFailure.category.protocol=\($protocol_categories) " +
    "runtimeFailure.category.process=\($process_categories) " +
    "runtimeFailure.category.cancellation=\($cancellation_categories) " +
    "runtimeFailure.category.usage=\($usage_categories) " +
    "runtimeFailure.category.policy=\($policy_categories) " +
    "runtimeFailure.category.unknown=\($unknown_categories) " +
    "runtimeFailure.causeCode.allowlist_match=\($allowlisted_causes) " +
    "runtimeFailure.causeCode.unknown=\($unknown_causes)"
  ' "$SSE_JSONL_LOG" 2>/dev/null); then
    diagnostic='pi image smoke auth diagnostic: total=0 session.error.canonical=0 session.error.legacy=0 PI_RPC_AUTH_ERROR=0 session.idle.canonical=0 session.idle.legacy=0 successful_tool_result=0 runtimeFailure.category.auth=0 runtimeFailure.category.model=0 runtimeFailure.category.endpoint=0 runtimeFailure.category.protocol=0 runtimeFailure.category.process=0 runtimeFailure.category.cancellation=0 runtimeFailure.category.usage=0 runtimeFailure.category.policy=0 runtimeFailure.category.unknown=0 runtimeFailure.causeCode.allowlist_match=0 runtimeFailure.causeCode.unknown=0'
  fi
  printf '%s\n' "$diagnostic" >&2
}

start_sse_capture() {
  docker exec "$CONTAINER_NAME" \
    curl --silent --show-error --no-buffer --max-time 300 \
    http://127.0.0.1:4096/event >"$SSE_LOG" 2>"$SSE_ERROR_LOG" &
  SSE_PID=$!

  local sse_connected=0
  local attempt
  for attempt in {1..20}; do
    if grep -F '"type":"server.connected"' "$SSE_LOG" >/dev/null 2>&1; then
      sse_connected=1
      break
    fi
    if ! kill -0 "$SSE_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  [[ "$sse_connected" -eq 1 ]]
}

if [[ "$CREDENTIAL_MODE" -eq 1 ]]; then
  start_sse_capture || fail "private SSE capture did not connect"

  if [[ "$EXPECT_AUTH_FAILURE" -eq 1 ]]; then
    PROMPT_JSON='{"prompt":"Reply with exactly ALMIRANT_PI_SMOKE_AUTH_FAILURE_SENTINEL_V1. Do not use tools."}'
    http_request POST "/session/$SESSION_ID/prompt_async" "$PROMPT_JSON" || fail "auth-failure prompt request failed"
    [[ "$HTTP_STATUS" == "204" ]] || fail "auth-failure prompt returned an unexpected status"
    unset PROMPT_JSON

    events_complete=0
    for attempt in {1..180}; do
      extract_sse_jsonl
      if jq -s -e 'any(.[]; .type == "session.idle" and .properties.kind == "session.idle")' "$SSE_JSONL_LOG" >/dev/null 2>&1; then
        if ! assert_auth_failure_events; then
          emit_auth_failure_event_diagnostic
          fail "auth-failure event contract did not settle exactly"
        fi
        events_complete=1
        break
      fi
      if ! kill -0 "$SSE_PID" 2>/dev/null; then
        break
      fi
      if [[ "$attempt" -lt 180 ]]; then
        sleep 1
      fi
    done
    [[ "$events_complete" -eq 1 ]] || fail "auth-failure event contract did not settle exactly"
    unset events_complete attempt
  else
    if ! bounded_docker exec "$CONTAINER_NAME" /bin/sh -c \
      'umask 077; printf "%s\n" "ALMIRANT_PI_SMOKE_READ_SENTINEL_V1" > /workspace/repo/pi-smoke-sentinel.txt; chmod 600 /workspace/repo/pi-smoke-sentinel.txt' \
      >"$EXEC_LOG" 2>&1; then
      fail "credentialed sentinel file could not be written"
    fi

    PROMPT_JSON='{"prompt":"Use the Read tool exactly once to read /workspace/repo/pi-smoke-sentinel.txt. Do not use any other tool. Reply with exactly the file contents."}'
    http_request POST "/session/$SESSION_ID/prompt_async" "$PROMPT_JSON" || fail "credentialed prompt request failed"
    [[ "$HTTP_STATUS" == "204" ]] || fail "credentialed prompt returned an unexpected status"
    unset PROMPT_JSON

    events_complete=0
    for attempt in {1..180}; do
      if assert_credentialed_events; then
        events_complete=1
        break
      fi
      if jq -s -e 'any(.[]; type == "object" and .type == "session.idle" and (.properties | type) == "object" and .properties.kind == "session.idle")' "$SSE_JSONL_LOG" >/dev/null 2>&1; then
        emit_credentialed_event_diagnostic
        fail "credentialed event contract did not settle exactly"
      fi
      if ! kill -0 "$SSE_PID" 2>/dev/null; then
        break
      fi
      if [[ "$attempt" -lt 180 ]]; then
        sleep 1
      fi
    done
    [[ "$events_complete" -eq 1 ]] || fail "credentialed event contract did not settle exactly"
    unset events_complete attempt
  fi
  stop_sse_capture
fi

http_request DELETE "/session/$SESSION_ID" || fail "session deletion failed"
[[ "$HTTP_STATUS" == "204" ]] || fail "session deletion did not return 204"
if grep -q '[^[:space:]]' "$HTTP_BODY_LOG"; then
  fail "session deletion returned an unexpected body"
fi
unset SESSION_ID

http_request GET /session || fail "session listing failed"
[[ "$HTTP_STATUS" == "200" ]] || fail "session listing returned an unexpected status"
jq -e 'type == "array" and length == 0' "$HTTP_BODY_LOG" >/dev/null 2>&1 || fail "session list was not empty after deletion"

: > "$EXEC_LOG"
if ! bounded_docker exec "$CONTAINER_NAME" find /tmp -mindepth 1 -maxdepth 1 -type d \
  -name 'almirant-pi-*' ! -name 'almirant-pi-agent' -print >"$EXEC_LOG" 2>&1; then
  fail "per-session temporary directories could not be inspected"
fi
[[ ! -s "$EXEC_LOG" ]] || fail "per-session temporary directories remained after deletion"

wait_for_readiness || fail "readiness did not remain healthy after deletion"

if ! bounded_docker stop --time 8 "$CONTAINER_NAME" >"$STOP_LOG" 2>&1; then
  fail "container did not stop within the cleanup bound"
fi
CONTAINER_STOPPED=1
stop_sse_capture

if ! bounded_docker logs "$CONTAINER_NAME" >"$CONTAINER_LOG" 2>&1; then
  fail "container logs could not be captured privately"
fi

assert_no_credential_material_in_private_logs || fail "credential material appeared in private smoke logs"

if [[ "$EXPECT_AUTH_FAILURE" -eq 1 ]]; then
  printf 'Pi image smoke passed (expected auth failure mode).\n'
elif [[ "$CREDENTIAL_MODE" -eq 1 ]]; then
  printf 'Pi image smoke passed (credentialed mode).\n'
else
  printf 'Pi image smoke passed (credential-free mode).\n'
fi
