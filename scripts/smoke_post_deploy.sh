#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-${CANARY_ADMIN_EMAIL:-}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${CANARY_ADMIN_PASSWORD:-}}"
SMOKE_CURL_CONNECT_TIMEOUT="${SMOKE_CURL_CONNECT_TIMEOUT:-3}"
SMOKE_CURL_TIMEOUT="${SMOKE_CURL_TIMEOUT:-15}"

if [[ -z "${ADMIN_EMAIL}" || -z "${ADMIN_PASSWORD}" ]]; then
  echo "SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD are required for post-deploy smoke" >&2
  exit 1
fi

PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --version >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3/python is required for smoke_post_deploy.sh" >&2
  exit 1
fi

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
TOKEN=""
API_KEY_ID=""
ROTATED_KEY_ID=""

call_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"

  local args=(
    -sS
    -o "$TMP_BODY"
    -w "%{http_code}"
    --connect-timeout "$SMOKE_CURL_CONNECT_TIMEOUT"
    --max-time "$SMOKE_CURL_TIMEOUT"
    -X "$method"
    "${BASE_URL}${path}"
  )
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi

  curl "${args[@]}"
}

fetch_headers() {
  local path="$1"

  local args=(
    -sS
    -D "$TMP_HEADERS"
    -o /dev/null
    --connect-timeout "$SMOKE_CURL_CONNECT_TIMEOUT"
    --max-time "$SMOKE_CURL_TIMEOUT"
    "${BASE_URL}${path}"
  )

  curl "${args[@]}" >/dev/null
}

json_read() {
  local key="$1"
  "$PYTHON_BIN" - "$TMP_BODY" "$key" <<'PY'
import json
import sys
path, key = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    obj = json.load(f)
parts = key.split('.')
cur = obj
for p in parts:
    if isinstance(cur, dict):
        cur = cur.get(p)
    else:
        cur = None
        break
if cur is None:
    print("")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

require_status() {
  local got="$1"
  local expected="$2"
  if [[ "$got" != "$expected" ]]; then
    echo "Unexpected status: got=${got} expected=${expected}" >&2
    echo "Response body:" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "$TOKEN" ]]; then
    if [[ -n "$ROTATED_KEY_ID" ]]; then
      call_api DELETE "/api/project/keys/${ROTATED_KEY_ID}" "" "$TOKEN" >/dev/null 2>&1 || true
    fi
    if [[ -n "$API_KEY_ID" ]]; then
      call_api DELETE "/api/project/keys/${API_KEY_ID}" "" "$TOKEN" >/dev/null 2>&1 || true
    fi
  fi

  rm -f "$TMP_BODY" "$TMP_HEADERS"
  exit "$exit_code"
}
trap cleanup EXIT

echo "[post-deploy-smoke] health check"
status_code="$(call_api GET /api/health)"
require_status "$status_code" "200"
health_status="$(json_read status)"
if [[ "${health_status}" == "degraded" ]]; then
  echo "Health status is degraded during post-deploy smoke" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[post-deploy-smoke] system status/setup"
status_code="$(call_api GET /api/system/status)"
require_status "$status_code" "200"
initialized="$(json_read initialized)"
if [[ "$initialized" != "True" && "$initialized" != "true" ]]; then
  setup_payload="$(printf '{"email":"%s","password":"%s","mode":"clean"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
  status_code="$(call_api POST /api/system/setup "$setup_payload")"
  require_status "$status_code" "200"
fi

echo "[post-deploy-smoke] CSP header"
fetch_headers /api/health
if ! grep -qi '^Content-Security-Policy:' "$TMP_HEADERS"; then
  echo "Missing Content-Security-Policy header" >&2
  cat "$TMP_HEADERS" >&2
  exit 1
fi

echo "[post-deploy-smoke] login"
login_payload="$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
status_code="$(call_api POST /api/auth/login "$login_payload")"
require_status "$status_code" "200"
TOKEN="$(json_read token)"
if [[ -z "$TOKEN" ]]; then
  echo "Login response missing token" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[post-deploy-smoke] api key rotate flow"
key_name="post_deploy_smoke_$(date +%s)"
create_key_payload="$(printf '{"name":"%s","role":"service_role","expires_in_days":7}' "$key_name")"
status_code="$(call_api POST /api/project/keys "$create_key_payload" "$TOKEN")"
require_status "$status_code" "201"
API_KEY_ID="$(json_read id)"
if [[ -z "$API_KEY_ID" ]]; then
  echo "API key creation response missing id" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

status_code="$(call_api POST "/api/project/keys/${API_KEY_ID}/rotate" '{"grace_minutes":1,"reason":"post deploy smoke"}' "$TOKEN")"
require_status "$status_code" "200"
ROTATED_KEY_ID="$(json_read new_id)"
if [[ -z "$ROTATED_KEY_ID" ]]; then
  echo "API key rotation response missing new_id" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[post-deploy-smoke] success"
